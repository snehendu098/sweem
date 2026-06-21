'use client'

// Thin client for sweem-server (ORG-LEVEL API). Writes are authenticated with a
// wallet personal-message signature matching the backend contract in src/lib/auth.ts:
//   message = `sweem:<rand>:<rand>:<unixSeconds>`  (TTL 60s)
// sent as headers X-Wallet-Address / X-Signature / X-Message.

import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import { useQuery } from '@tanstack/react-query'
import { API_BASE } from './sweem'
import { TOKEN_SYMBOLS, type TokenSymbol } from './tokens'

function authMessage(): string {
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `sweem:${rand()}:${rand()}:${Math.floor(Date.now() / 1000)}`
}

export interface RateInput {
  token: string
  rate_amount: number
  rate_type: 'MONTHLY' | 'HOURLY'
}

export interface Org {
  // NOTE: the backend serializes drizzle rows in camelCase (walletAddress, …).
  wallet?: string
  walletAddress?: string
  name: string
  logoUrl?: string | null
  email?: string | null
  emailVerifiedAt?: string | null
  createdAt?: string
}

export interface Group {
  id: string
  orgWallet: string
  name: string
}

export interface EmployeeRate {
  token: string
  // Postgres numeric columns are serialized as strings — coerce with Number() at use sites.
  rateAmount: string
  rateType: string
  slice_per_ms?: number
}

export interface Employee {
  id: string
  alias: string
  walletAddress: string
  orgWallet: string
  groupId: string | null
  rates: EmployeeRate[]
}

export interface Pool {
  id: string
  orgWallet: string
  token: string
  onChainPoolId: string
}

export type InvoiceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID'

export interface Invoice {
  id: string
  orgWallet: string
  employeeId: string
  amount: string
  token: string
  description: string
  status: InvoiceStatus
  dueDate: string | null
  attachmentKey: string | null
  note: string | null
  txHash: string | null
  createdAt: string
  paidAt: string | null
  employee?: { alias: string; walletAddress: string }
}

export interface ApiKeyRow {
  id: string
  orgWallet: string
  name: string
  key: string
  receivingAddress: string | null
  createdAt: string
}

export interface YieldQuote {
  protocol: 'NAVI' | 'SCALLOP' | 'SUILEND' | 'USDY' | 'STSUI'
  apy: number
}

export interface YieldResponse {
  token: string
  quotes: YieldQuote[]
}

export interface AddEmployeeInput {
  alias: string
  wallet_address: string
  email?: string | null
  group_id?: string
  rates: RateInput[]
}

// ----- onboarding: CSV import + email verification -----

export type MappingField =
  | 'alias'
  | 'wallet_address'
  | 'email'
  | 'rate_amount'
  | 'rate_type'
  | 'group'

export type ColumnMapping = Record<MappingField, string | null>

export interface MapCsvResult {
  mapping: ColumnMapping
  defaults: { token: 'USDC'; rate_type: 'MONTHLY' }
  source: 'heuristic' | 'ai' | 'mixed'
}

export interface BulkEmployeeInput {
  alias: string
  wallet_address: string
  email?: string | null
  group_id?: string | null
  group_name?: string | null
  rates?: RateInput[]
}

export interface BulkResult {
  created: number
  updated: number
  skipped: { wallet_address: string; reason: string }[]
  failed: { wallet_address: string; message: string }[]
}

export interface StartEmailResult {
  ok: boolean
  sent: boolean
  sendError?: string
  devMode?: boolean
  code?: string
}

export function useSweemApi() {
  const account = useCurrentAccount()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const wallet = account?.address

  // Sign one auth message. The backend validates signature + timestamp (60s TTL)
  // with no nonce, so a single signature can authorize a burst of requests — which
  // is what bulk operations reuse to avoid one wallet popup per row.
  type AuthCreds = { message: string; signature: string }
  async function signAuth(): Promise<AuthCreds> {
    if (!account) throw new Error('Connect a wallet first')
    const message = authMessage()
    const { signature } = await signPersonalMessage({
      message: new TextEncoder().encode(message),
    })
    return { message, signature }
  }

  async function sendAuthed(creds: AuthCreds, path: string, method: string, body?: unknown) {
    if (!account) throw new Error('Connect a wallet first')
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': account.address,
        'X-Signature': creds.signature,
        'X-Message': creds.message,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && res.status !== 409) {
      throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`)
    }
    return {
      status: res.status,
      data: res.status === 204 ? null : await res.json().catch(() => null),
    }
  }

  async function authedFetch(path: string, method: string, body?: unknown) {
    return sendAuthed(await signAuth(), path, method, body)
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return res.json() as Promise<T>
  }

  // ----- reads (react-query) -----
  const orgQuery = useQuery<Org | null>({
    queryKey: ['org', wallet],
    enabled: !!wallet,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/v1/orgs/${wallet}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GET /v1/orgs/${wallet} → ${res.status}`)
      return res.json() as Promise<Org>
    },
  })

  const hasOrg = !!orgQuery.data

  const groupsQuery = useQuery<Group[]>({
    queryKey: ['groups', wallet],
    enabled: !!wallet && hasOrg,
    queryFn: () => get<Group[]>(`/v1/orgs/${wallet}/groups`),
  })

  const employeesQuery = useQuery<Employee[]>({
    queryKey: ['employees', wallet],
    enabled: !!wallet && hasOrg,
    queryFn: () => get<Employee[]>(`/v1/orgs/${wallet}/employees`),
  })

  // Publishable API keys for the checkout SDK. Read is unauthenticated (keys are
  // client-safe); create/revoke are wallet-signed.
  const apiKeysQuery = useQuery<ApiKeyRow[]>({
    queryKey: ['apiKeys', wallet],
    enabled: !!wallet && hasOrg,
    queryFn: () => get<ApiKeyRow[]>(`/v1/orgs/${wallet}/keys`),
  })

  // One yields fetch per supported token, surfaced as a map keyed by symbol.
  const yieldsByToken = useQuery<Record<TokenSymbol, YieldResponse>>({
    queryKey: ['yields', TOKEN_SYMBOLS],
    queryFn: async () => {
      const entries = await Promise.all(
        TOKEN_SYMBOLS.map(async (symbol) => {
          const res = await get<YieldResponse>(`/v1/compute/yields?token=${symbol}`)
          return [symbol, res] as const
        }),
      )
      return Object.fromEntries(entries) as Record<TokenSymbol, YieldResponse>
    },
  })

  return {
    address: wallet,

    // queries
    orgQuery,
    groupsQuery,
    employeesQuery,
    yieldsByToken,
    apiKeysQuery,

    // ----- API keys (checkout SDK) -----
    createApiKey: (name: string, receivingAddress?: string) =>
      authedFetch(`/v1/orgs/${wallet}/keys`, 'POST', {
        name,
        ...(receivingAddress ? { receiving_address: receivingAddress } : {}),
      }),

    revokeApiKey: (id: string) => authedFetch(`/v1/orgs/${wallet}/keys/${id}`, 'DELETE'),

    // ----- writes -----
    // Idempotent org create (409 = already exists → fine).
    ensureOrg: (name: string) => authedFetch('/v1/orgs', 'POST', { name }),

    getOrg: (w: string) => get<Org>(`/v1/orgs/${w}`),

    // Update org profile (name and/or logo). Wallet-signed.
    updateOrg: (input: { name?: string; logo_url?: string }) =>
      authedFetch(`/v1/orgs/${wallet}`, 'PUT', input),

    createGroup: (w: string, name: string) =>
      authedFetch(`/v1/orgs/${w}/groups`, 'POST', { name }),

    listGroups: (w: string) => get<Group[]>(`/v1/orgs/${w}/groups`),

    addEmployee: (w: string, input: AddEmployeeInput) =>
      authedFetch(`/v1/orgs/${w}/employees`, 'POST', input),

    // Replace an employee's group and/or full per-token rate set (PUT semantics:
    // the `rates` array fully replaces the employee's existing rates).
    updateEmployee: (
      w: string,
      employeeId: string,
      input: { group_id?: string | null; rates: RateInput[] },
    ) => authedFetch(`/v1/orgs/${w}/employees/${employeeId}`, 'PUT', input),

    // Update many employees' rates with a SINGLE wallet signature (reused across
    // every PUT). Each entry's `rates` fully replaces that employee's rate set.
    bulkUpdateRates: async (
      w: string,
      updates: { employeeId: string; rates: RateInput[] }[],
    ) => {
      if (updates.length === 0) return
      const creds = await signAuth()
      await Promise.all(
        updates.map((u) =>
          sendAuthed(creds, `/v1/orgs/${w}/employees/${u.employeeId}`, 'PUT', { rates: u.rates }),
        ),
      )
    },

    listEmployees: (w: string) => get<Employee[]>(`/v1/orgs/${w}/employees`),

    // ----- onboarding -----
    // AI-infer CSV column mapping (sends only headers + a few sample rows).
    mapCsv: async (headers: string[], samples: string[][]): Promise<MapCsvResult> => {
      const { data } = await authedFetch('/v1/ai/map-csv', 'POST', { headers, samples })
      return data as MapCsvResult
    },

    bulkAddEmployees: async (w: string, employees: BulkEmployeeInput[]): Promise<BulkResult> => {
      const { data } = await authedFetch(`/v1/orgs/${w}/employees/bulk`, 'POST', { employees })
      return data as BulkResult
    },

    startEmailVerification: async (w: string, email: string): Promise<StartEmailResult> => {
      const { data } = await authedFetch(`/v1/orgs/${w}/email/start`, 'POST', { email })
      return data as StartEmailResult
    },

    confirmEmail: (w: string, code: string) =>
      authedFetch(`/v1/orgs/${w}/email/confirm`, 'POST', { code }),

    createPool: (w: string, token: TokenSymbol, onChainPoolId: string) =>
      authedFetch(`/v1/orgs/${w}/pools`, 'POST', {
        token,
        on_chain_pool_id: onChainPoolId,
      }),

    listPools: (w: string) => get<Pool[]>(`/v1/orgs/${w}/pools`),

    getYields: (token: TokenSymbol) => get<YieldResponse>(`/v1/compute/yields?token=${token}`),

    // Best-effort org-name lookup for the employee portal. NEVER throws — if the
    // backend is down/unreachable the employee UI just falls back to the address.
    getOrgName: async (orgWallet: string): Promise<string | null> => {
      try {
        const res = await fetch(`${API_BASE}/v1/orgs/${orgWallet}`)
        if (!res.ok) return null
        const org = (await res.json()) as Org
        return org?.name ?? null
      } catch {
        return null
      }
    },

    listOrgInvoices: (w: string, status?: string) =>
      get<Invoice[]>(`/v1/orgs/${w}/invoices${status ? `?status=${status}` : ''}`),

    updateOrgInvoice: (w: string, id: string, status: InvoiceStatus, note?: string) =>
      authedFetch(`/v1/orgs/${w}/invoices/${id}`, 'PUT', { status, note }),

    // Update many invoices with a SINGLE wallet signature (reused across every PUT
    // within the 60s TTL) — e.g. approve all pending at once.
    bulkUpdateOrgInvoices: async (
      w: string,
      updates: { id: string; status: InvoiceStatus; note?: string }[],
    ) => {
      if (updates.length === 0) return
      const creds = await signAuth()
      await Promise.all(
        updates.map((u) =>
          sendAuthed(creds, `/v1/orgs/${w}/invoices/${u.id}`, 'PUT', { status: u.status, note: u.note }),
        ),
      )
    },

    // Mark PAID by submitting the on-chain payment digest — backend verifies the
    // tx credited the employee, so no wallet message signature is needed here.
    payOrgInvoice: async (w: string, id: string, txHash: string) => {
      const res = await fetch(`${API_BASE}/v1/orgs/${w}/invoices/${id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_hash: txHash }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Pay failed: ${res.status}`)
      return res.json()
    },

  }
}
