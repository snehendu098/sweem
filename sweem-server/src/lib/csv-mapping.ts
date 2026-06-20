import type { Bindings } from '../env/bindings'

// Target employee fields we try to source from arbitrary CSV columns. Values in
// a returned mapping are the EXACT header strings from the uploaded CSV (or null).
export const MAPPING_FIELDS = [
  'alias',
  'wallet_address',
  'email',
  'rate_amount',
  'rate_type',
  'group',
] as const

export type MappingField = (typeof MAPPING_FIELDS)[number]
export type ColumnMapping = Record<MappingField, string | null>

export type MapResult = {
  mapping: ColumnMapping
  defaults: { token: 'USDC'; rate_type: 'MONTHLY' }
  source: 'heuristic' | 'ai' | 'mixed'
}

const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

// Header keyword patterns, checked against a normalized (lowercased, alnum-only)
// header. Order within each list = priority.
const PATTERNS: Record<MappingField, string[]> = {
  alias: ['alias', 'fullname', 'employeename', 'name', 'employee', 'displayname', 'firstname'],
  wallet_address: ['walletaddress', 'suiaddress', 'wallet', 'suiwallet', 'address', 'recipient', 'account', 'sui'],
  email: ['emailaddress', 'email', 'mail', 'workemail'],
  rate_amount: ['rateamount', 'monthlysalary', 'salary', 'monthly', 'compensation', 'rate', 'amount', 'wage', 'pay', 'usdc'],
  rate_type: ['ratetype', 'frequency', 'cadence', 'period', 'paytype', 'type'],
  group: ['groupname', 'group', 'department', 'dept', 'team', 'division', 'role'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Deterministic header matching. Each field claims the first header whose
// normalized form contains one of its keywords; a header is used at most once.
export function heuristicMap(headers: string[]): ColumnMapping {
  const mapping = Object.fromEntries(MAPPING_FIELDS.map((f) => [f, null])) as ColumnMapping
  const taken = new Set<string>()
  const normed = headers.map((h) => ({ raw: h, n: norm(h) }))

  for (const field of MAPPING_FIELDS) {
    for (const kw of PATTERNS[field]) {
      const hit = normed.find((h) => !taken.has(h.raw) && h.n.includes(kw))
      if (hit) {
        mapping[field] = hit.raw
        taken.add(hit.raw)
        break
      }
    }
  }
  return mapping
}

// Ask Workers AI to fill the still-unmapped fields. Returns header names (must be
// from `headers`) or null. Never throws — returns {} on any failure.
async function aiMap(
  env: Bindings,
  headers: string[],
  samples: string[][],
  missing: MappingField[],
): Promise<Partial<ColumnMapping>> {
  const sampleBlock = samples
    .slice(0, 3)
    .map((row, i) => `Row ${i + 1}: ${headers.map((h, j) => `${h}=${row[j] ?? ''}`).join(' | ')}`)
    .join('\n')

  const system =
    'You map spreadsheet columns to known employee fields for a payroll system. ' +
    'Respond with ONLY a JSON object, no prose, no code fences. ' +
    'Each key maps to the EXACT matching column header from the provided list, or null if none fits. ' +
    'Fields: alias (person name), wallet_address (a Sui/blockchain 0x address), email, ' +
    'rate_amount (numeric salary/pay), rate_type (MONTHLY or HOURLY indicator column), group (team/department).'

  const user =
    `Headers: ${JSON.stringify(headers)}\n` +
    `Only map these fields: ${JSON.stringify(missing)}\n` +
    `Sample rows:\n${sampleBlock}\n` +
    `Return JSON like {${missing.map((m) => `"${m}": "<header or null>"`).join(', ')}}.`

  try {
    const resp = (await env.AI.run(WORKERS_AI_MODEL as never, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 256,
    } as never)) as { response?: string }

    const text = resp?.response ?? ''
    const json = extractJson(text)
    if (!json) return {}

    const out: Partial<ColumnMapping> = {}
    for (const field of missing) {
      const v = json[field]
      if (typeof v === 'string' && headers.includes(v)) out[field] = v
    }
    return out
  } catch {
    return {}
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// Heuristics first; Workers AI only fills the gaps for the core fields. This keeps
// the LLM call tiny and bounds the blast radius if the model returns junk.
export async function inferMapping(
  env: Bindings,
  headers: string[],
  samples: string[][],
): Promise<MapResult> {
  const mapping = heuristicMap(headers)

  // Core fields needed to build a usable employee row.
  const core: MappingField[] = ['alias', 'wallet_address', 'rate_amount', 'email', 'group']
  const missing = core.filter((f) => mapping[f] === null)

  let source: MapResult['source'] = 'heuristic'
  if (missing.length > 0) {
    const ai = await aiMap(env, headers, samples, missing)
    let used = false
    for (const [k, v] of Object.entries(ai)) {
      if (v && mapping[k as MappingField] === null) {
        mapping[k as MappingField] = v
        used = true
      }
    }
    if (used) source = 'mixed'
  }

  return { mapping, defaults: { token: 'USDC', rate_type: 'MONTHLY' }, source }
}
