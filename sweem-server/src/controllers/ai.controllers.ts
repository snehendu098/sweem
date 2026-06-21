import type { Context } from 'hono'
import { streamText, type UIMessage } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { inferMapping } from '../lib/csv-mapping'
import { createDb } from '../db/client'
import { employees as empTable, paymentGroups, orgPools } from '../db/schema'
import type { AuthEnv } from '../types'

// POST /v1/ai/map-csv — given CSV headers + sample rows, return a column → field
// mapping. Auth-gated (any registered wallet) to avoid open AI usage.
export async function mapCsv(c: Context<AuthEnv>) {
  const { headers, samples } = await c.req.json()
  const result = await inferMapping(c.env, headers, samples ?? [])
  return c.json(result)
}

const PHASE1_SYSTEM = `You are a function dispatcher. You MUST respond with ONLY a single JSON object — no text, no explanation, no markdown.

Output format (EXACTLY this structure):
{"type":"function","name":"<function_name>","parameters":{<args>}}

Available functions:
- listEmployees — use for: list employees, how many employees, roster, staff count. parameters: {}
- getEmployeeDetails — use for: info about specific person. parameters: {"query":"<name or address>"}
- analyzePayroll — use for: payroll totals, monthly cost, breakdown, charts. parameters: {}
- getProtocolInfo — use for: how does Sweem work, fees, protocol, yield, vaults. parameters: {}
- getSdkInfo — use for: SDK, developer docs, API. parameters: {}
- prepareAddEmployee — use for: add employee. parameters: {"alias":"","wallet_address":"","rate_amount":0,"rate_type":"MONTHLY","token":"USDC"}
- prepareBulkAddFromCsv — use for: CSV import. parameters: {"employees":[]}
- preparePauseStream — use for: pause stream. parameters: {"employeeQuery":"<name>"}
- prepareResumeStream — use for: resume stream. parameters: {"employeeQuery":"<name>"}
- prepareStartStream — use for: start streaming. parameters: {}
- prepareEditEmployee — use for: edit employee. parameters: {"employeeQuery":"<name>","changes":{}}
- noOp — use for: greetings, thanks, general chat. parameters: {}

IMPORTANT: Output ONLY the JSON. Nothing else. No text before or after.`

// POST /v1/ai/chat — streaming AI agent for payroll management.
// No auth required — the agent only reads from the context provided in the request body.
// All write operations return pendingAction data for the client to sign.
export async function chatHandler(c: Context<AuthEnv>) {
  const body = await c.req.json() as {
    messages: UIMessage[]
    context?: { walletAddress?: string }
  }

  const messages = body.messages ?? []
  const orgWallet = body.context?.walletAddress

  // Fetch org data from DB using wallet as primary key
  const db = createDb(c.env.DB.connectionString)
  const [employeeRows, groupRows, poolRows] = await Promise.all([
    orgWallet
      ? db.query.employees.findMany({ where: eq(empTable.orgWallet, orgWallet), with: { rates: true } })
      : Promise.resolve([]),
    orgWallet
      ? db.query.paymentGroups.findMany({ where: eq(paymentGroups.orgWallet, orgWallet) })
      : Promise.resolve([]),
    orgWallet
      ? db.query.orgPools.findMany({ where: eq(orgPools.orgWallet, orgWallet) })
      : Promise.resolve([]),
  ])

  const employees = employeeRows.map(e => ({
    id: e.id,
    alias: e.alias,
    walletAddress: e.walletAddress,
    groupId: e.groupId ?? null,
    rates: e.rates.map(r => ({ token: r.token!, rateAmount: r.rateAmount ?? '0', rateType: r.rateType ?? 'MONTHLY' })),
  }))
  const groups = groupRows.map(g => ({ id: g.id, name: g.name }))
  const pools = poolRows.map(p => ({ id: p.id, token: p.token, onChainPoolId: p.onChainPoolId }))

  const workersai = createWorkersAI({ binding: c.env.AI })
  const model = workersai('@cf/meta/llama-3.3-70b-instruct-fp8-fast')

  const tools = {
      respondWithText: {
        description: 'Provide your final text response to the user after reviewing the tool result. Always call this as your LAST step.',
        inputSchema: z.object({ text: z.string().describe('Your helpful reply to the user') }),
        execute: async ({ text }: { text: string }) => ({ text }),
      },

      listEmployees: {
        description: 'List all employees in the organization with their payment rates and stream status',
        inputSchema: z.object({}),
        execute: async () => ({
          employees: employees.map(e => ({
            id: e.id,
            alias: e.alias,
            walletAddress: e.walletAddress,
            groupId: e.groupId,
            groupName: groups.find(g => g.id === e.groupId)?.name ?? null,
            rates: e.rates,
          })),
          count: employees.length,
        }),
      },

      getEmployeeDetails: {
        description: 'Get details about a specific employee by searching their name or wallet address',
        inputSchema: z.object({
          query: z.string().describe('Employee name (alias) or partial wallet address to search for'),
        }),
        execute: async ({ query }: { query: string }) => {
          const q = query.toLowerCase()
          const found = employees.filter(e =>
            e.alias.toLowerCase().includes(q) || e.walletAddress.toLowerCase().includes(q)
          )
          return {
            employees: found.map(e => ({
              ...e,
              groupName: groups.find(g => g.id === e.groupId)?.name ?? null,
            })),
            found: found.length > 0,
          }
        },
      },

      analyzePayroll: {
        description: 'Analyze payroll data — compute totals, group breakdown for charts and summaries',
        inputSchema: z.object({}),
        execute: async () => {
          const byGroup: Record<string, { name: string; count: number; monthlyUSDC: number; monthlySUI: number }> = {}
          for (const emp of employees) {
            const gName = groups.find(g => g.id === emp.groupId)?.name ?? 'Ungrouped'
            if (!byGroup[gName]) byGroup[gName] = { name: gName, count: 0, monthlyUSDC: 0, monthlySUI: 0 }
            byGroup[gName].count++
            for (const rate of emp.rates) {
              const amt = Number(rate.rateAmount) || 0
              const monthly = rate.rateType === 'MONTHLY' ? amt : amt * 160
              if (rate.token === 'USDC') byGroup[gName].monthlyUSDC += monthly
              if (rate.token === 'SUI') byGroup[gName].monthlySUI += monthly
            }
          }
          const groups_data = Object.values(byGroup)
          return {
            chartData: groups_data,
            totals: {
              employeeCount: employees.length,
              monthlyUSDC: groups_data.reduce((s, g) => s + g.monthlyUSDC, 0),
              monthlySUI: groups_data.reduce((s, g) => s + g.monthlySUI, 0),
            },
          }
        },
      },

      getProtocolInfo: {
        description: 'Get information about the Sweem protocol, how it works, fees, and features',
        inputSchema: z.object({
          topic: z.string().optional().describe('Specific topic: streams, yield, tokens, fees, vaults'),
        }),
        execute: async ({ topic }: { topic?: string }) => ({
          protocol: 'Sweem',
          blockchain: 'Sui (mainnet)',
          features: [
            'Real-time per-second salary streaming',
            'Multi-token: USDC and SUI',
            'Five yield protocols across three types: Navi (L), Scallop (L), Suilend (L), Ondo USDY (Y), stSUI (S)',
            'Org payroll pools earn yield on idle funds via L/Y protocols (Navi, Scallop, Suilend, USDY) — never LSTs',
            'Employee personal vaults support all five (L/Y/S) including stSUI liquid staking',
            'One StreamPool per org per token — employees share pool liquidity',
          ],
          protocols: [
            { name: 'Navi', type: 'L', scope: 'pool+vault' },
            { name: 'Scallop', type: 'L', scope: 'pool+vault' },
            { name: 'Suilend', type: 'L', scope: 'pool+vault' },
            { name: 'Ondo USDY', type: 'Y', scope: 'pool+vault' },
            { name: 'stSUI', type: 'S', scope: 'vault-only' },
          ],
          topic: topic ?? 'general',
        }),
      },

      getSdkInfo: {
        description: 'Get information about the Sweem developer SDK and documentation (coming soon)',
        inputSchema: z.object({}),
        execute: async () => ({
          status: 'coming_soon',
          message: 'The Sweem SDK and developer documentation are coming soon. Planned: TypeScript client SDK, Move contract ABIs, webhook integrations, REST API reference, and example integrations.',
        }),
      },

      prepareAddEmployee: {
        description: 'Prepare to add a new employee to the organization. Returns a pending action the user must confirm and sign.',
        inputSchema: z.object({
          alias: z.string().describe('Employee display name'),
          wallet_address: z.string().describe('Employee Sui wallet address (0x...)'),
          email: z.string().optional().describe('Employee email address'),
          rate_amount: z.number().describe('Payment amount per period'),
          rate_type: z.enum(['MONTHLY', 'HOURLY']).describe('Payment frequency'),
          token: z.enum(['USDC', 'SUI']).describe('Payment token'),
          group_name: z.string().optional().describe('Department or group name'),
        }),
        execute: async (data: { alias: string; wallet_address: string; email?: string; rate_amount: number; rate_type: 'MONTHLY' | 'HOURLY'; token: 'USDC' | 'SUI'; group_name?: string }) => ({
          type: 'pendingAction' as const,
          action: 'addEmployee' as const,
          data,
          summary: `Add ${data.alias} at ${data.rate_amount} ${data.token}/${data.rate_type.toLowerCase()}`,
        }),
      },

      prepareBulkAddFromCsv: {
        description: 'Prepare to bulk-add multiple employees from parsed CSV data. Returns a pending action the user must confirm.',
        inputSchema: z.object({
          employees: z.array(z.object({
            alias: z.string(),
            wallet_address: z.string(),
            email: z.string().optional(),
            rate_amount: z.number().optional(),
            rate_type: z.enum(['MONTHLY', 'HOURLY']).optional(),
            token: z.string().optional(),
            group_name: z.string().optional(),
          })).describe('Array of employees parsed from CSV'),
        }),
        execute: async ({ employees: rows }: { employees: Array<{ alias: string; wallet_address: string; email?: string; rate_amount?: number; rate_type?: 'MONTHLY' | 'HOURLY'; token?: string; group_name?: string }> }) => ({
          type: 'pendingAction' as const,
          action: 'bulkAdd' as const,
          data: rows,
          summary: `Bulk add ${rows.length} employee${rows.length !== 1 ? 's' : ''}`,
        }),
      },

      preparePauseStream: {
        description: 'Prepare to pause the payment stream for an employee. The stream stops accruing until resumed.',
        inputSchema: z.object({
          employeeQuery: z.string().describe('Employee name or partial wallet address'),
          token: z.enum(['USDC', 'SUI']).optional().describe('Which token stream to pause (defaults to USDC)'),
        }),
        execute: async ({ employeeQuery, token = 'USDC' }: { employeeQuery: string; token?: 'USDC' | 'SUI' }) => {
          const q = employeeQuery.toLowerCase()
          const emp = employees.find(e => e.alias.toLowerCase().includes(q) || e.walletAddress.toLowerCase().includes(q))
          if (!emp) return { error: true, message: `No employee found matching "${employeeQuery}"` }
          const pool = pools.find(p => p.token === token)
          return {
            type: 'pendingAction' as const,
            action: 'pauseStream' as const,
            data: { employeeId: emp.id, employeeWallet: emp.walletAddress, alias: emp.alias, token, poolId: pool?.onChainPoolId },
            summary: `Pause ${token} stream for ${emp.alias}`,
          }
        },
      },

      prepareResumeStream: {
        description: 'Prepare to resume the payment stream for an employee whose stream is currently paused.',
        inputSchema: z.object({
          employeeQuery: z.string().describe('Employee name or partial wallet address'),
          token: z.enum(['USDC', 'SUI']).optional().describe('Which token stream to resume (defaults to USDC)'),
        }),
        execute: async ({ employeeQuery, token = 'USDC' }: { employeeQuery: string; token?: 'USDC' | 'SUI' }) => {
          const q = employeeQuery.toLowerCase()
          const emp = employees.find(e => e.alias.toLowerCase().includes(q) || e.walletAddress.toLowerCase().includes(q))
          if (!emp) return { error: true, message: `No employee found matching "${employeeQuery}"` }
          const pool = pools.find(p => p.token === token)
          return {
            type: 'pendingAction' as const,
            action: 'resumeStream' as const,
            data: { employeeId: emp.id, employeeWallet: emp.walletAddress, alias: emp.alias, token, poolId: pool?.onChainPoolId },
            summary: `Resume ${token} stream for ${emp.alias}`,
          }
        },
      },

      prepareStartStream: {
        description: 'Find employees with rates configured but no active stream, and prepare to start streaming for them.',
        inputSchema: z.object({
          token: z.enum(['USDC', 'SUI']).optional().describe('Token stream to start (defaults to USDC)'),
          employeeQuery: z.string().optional().describe('Optionally target a specific employee by name'),
        }),
        execute: async ({ token = 'USDC', employeeQuery }: { token?: 'USDC' | 'SUI'; employeeQuery?: string }) => {
          let eligible = employees.filter(e => e.rates.some(r => r.token === token))
          if (employeeQuery) {
            const q = employeeQuery.toLowerCase()
            eligible = eligible.filter(e => e.alias.toLowerCase().includes(q) || e.walletAddress.toLowerCase().includes(q))
          }
          const pool = pools.find(p => p.token === token)
          return {
            type: 'pendingAction' as const,
            action: 'startStream' as const,
            data: {
              token,
              poolId: pool?.onChainPoolId,
              employees: eligible.map(e => ({ id: e.id, alias: e.alias, walletAddress: e.walletAddress, rates: e.rates })),
            },
            summary: `Start ${token} streams for ${eligible.length} employee${eligible.length !== 1 ? 's' : ''}`,
          }
        },
      },

      prepareEditEmployee: {
        description: "Prepare to edit an employee's payment rate or group assignment.",
        inputSchema: z.object({
          employeeQuery: z.string().describe('Employee name or partial wallet address'),
          changes: z.object({
            rate_amount: z.number().optional().describe('New payment amount'),
            rate_type: z.enum(['MONTHLY', 'HOURLY']).optional().describe('New rate type'),
            token: z.enum(['USDC', 'SUI']).optional().describe('Token for rate change'),
            group_name: z.string().optional().describe('New group/department name'),
          }).describe('Fields to change'),
        }),
        execute: async ({ employeeQuery, changes }: { employeeQuery: string; changes: { rate_amount?: number; rate_type?: 'MONTHLY' | 'HOURLY'; token?: 'USDC' | 'SUI'; group_name?: string } }) => {
          const q = employeeQuery.toLowerCase()
          const emp = employees.find(e => e.alias.toLowerCase().includes(q) || e.walletAddress.toLowerCase().includes(q))
          if (!emp) return { error: true, message: `No employee found matching "${employeeQuery}"` }
          return {
            type: 'pendingAction' as const,
            action: 'editEmployee' as const,
            data: { employeeId: emp.id, alias: emp.alias, walletAddress: emp.walletAddress, changes },
            summary: `Edit ${emp.alias}: ${Object.entries(changes).filter(([, v]) => v != null).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
          }
        },
      },

      noOp: {
        description: 'Use for conversational messages that need no data lookup (greetings, thanks, general capability questions)',
        inputSchema: z.object({ intent: z.string().optional() }),
        execute: async () => ({ done: true }),
      },
    }

  const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

  // Phase 1: prompt-based function dispatch.
  // tool_choice:'required' causes Llama fp8-fast to error on Cloudflare Workers AI.
  // Instead: system prompt forces JSON-only output, we parse the function call.
  const p1Msgs: { role: string; content: string }[] = [
    { role: 'system', content: PHASE1_SYSTEM }, // forced JSON dispatch prompt
    ...messages.flatMap(m => {
      if (m.role !== 'user' && m.role !== 'assistant') return []
      const text = (m.parts ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { type: string; text?: string }) => p.text ?? '').join('')
      return text ? [{ role: m.role as string, content: text }] : []
    }),
  ]

  type NativeResp = { response?: string | null }
  const p1Raw = (await c.env.AI.run(MODEL as never, {
    messages: p1Msgs,
    max_tokens: 200,
    stream: false,
  } as never)) as NativeResp

  type TR = { toolCallId: string; toolName: string; input: unknown; output: unknown }
  const toolResults: TR[] = []

  // Workers AI returns `response` as a parsed object when model outputs function call JSON.
  // Access the parsed function call directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p1Obj = (p1Raw as any).response as { name?: string; parameters?: Record<string, unknown> } | null
  if (p1Obj && typeof p1Obj === 'object' && p1Obj.name) {
    const toolName = p1Obj.name
    const toolDef = tools[toolName as keyof typeof tools]
    if (toolDef) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = (p1Obj.parameters ?? {}) as any
      const toolCallId = `t-${Date.now().toString(36)}`
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (toolDef as any).execute(args)
      toolResults.push({ toolCallId, toolName, input: args, output })
    }
  } else {
    // Fallback: try parsing content string if response is not parsed object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (p1Raw as any).choices?.[0]?.message?.content as string | undefined
    if (content) {
      const s = content.trim()
      const js = s.indexOf('{'); const je = s.lastIndexOf('}')
      if (js !== -1 && je > js) {
        try {
          const parsed = JSON.parse(s.slice(js, je + 1)) as Record<string, unknown>
          const toolName = (parsed.name ?? parsed.function) as string | undefined
          const toolDef = toolName ? tools[toolName as keyof typeof tools] : undefined
          if (toolName && toolDef) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const args = (parsed.parameters ?? parsed.arguments ?? {}) as any
            const toolCallId = `t-${Date.now().toString(36)}`
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const output = await (toolDef as any).execute(args)
            toolResults.push({ toolCallId, toolName, input: args, output })
          }
        } catch { /* not JSON */ }
      }
    }
  }

  const PHASE2_PROMPT = `You are Sweem AI, a helpful payroll assistant for the Sweem streaming payroll protocol on Sui blockchain.
A tool was called and its result is provided. Write a concise, helpful reply based on that result only.
- For employee data: state the actual numbers/names from the result. Never guess or invent numbers.
- For prepare* actions: say the action card is ready and the user should click Sign & Execute.
- For noOp / no result: answer conversationally.
Keep the reply short and direct. No markdown headers.`

  // Build phase 2 messages: user question + tool result summary injected as context
  const toolContext = toolResults.length > 0
    ? `\n\nTool result:\n${JSON.stringify(toolResults[0].output, null, 2)}`
    : ''
  const lastUserMsg = messages.filter(m => m.role === 'user').at(-1)
  const userText = (lastUserMsg?.parts ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { type: string; text?: string }) => p.text ?? '').join('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p2Messages: any[] = [
    { role: 'user', content: userText + toolContext },
  ]

  const phase2 = streamText({ model, system: PHASE2_PROMPT, messages: p2Messages })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
      emit({ type: 'start' })

      // Emit tool events for the UI (so cards render)
      if (toolResults.length > 0) {
        const tr = toolResults[0]
        emit({ type: 'start-step' })
        emit({ type: 'tool-input-start', toolCallId: tr.toolCallId, toolName: tr.toolName })
        emit({ type: 'tool-input-available', toolCallId: tr.toolCallId, toolName: tr.toolName, input: tr.input })
        emit({ type: 'tool-output-available', toolCallId: tr.toolCallId, output: tr.output })
        emit({ type: 'finish-step' })
      }

      // Stream phase 2 text
      emit({ type: 'start-step' })
      const textId = `txt-${Date.now().toString(36)}`
      emit({ type: 'text-start', id: textId })
      let prev = ''
      for await (const delta of phase2.textStream) {
        if (delta === prev) continue // fp8-fast echo dedup
        prev = delta
        emit({ type: 'text-delta', id: textId, delta })
      }
      emit({ type: 'text-end', id: textId })
      emit({ type: 'finish-step' })
      emit({ type: 'finish', finishReason: 'stop' })
      ctrl.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
