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
  wallet: string
  name: string
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
  group_id?: string
  rates: RateInput[]
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
  createdAt: string
  paidAt: string | null
}

export interface EmployeeOrgEntry {
  orgWallet: string
  orgName: string
  employeeId: string
  alias: string
}

export interface CreateInvoiceInput {
  org_wallet: string
  amount: number
  token: string
  description: string
  due_date?: string
  attachment_key?: string
}

export function useSweemApi() {
  const account = useCurrentAccount()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const wallet = account?.address

  // Sign one auth message. Backend validates signature + timestamp (60s TTL) with
  // no nonce, so a single signature can authorize a burst of requests — reused to
  // avoid a second wallet popup (e.g. upload attachment + create invoice).
  type AuthCreds = { message: string; signature: string }
  async function signAuth(): Promise<AuthCreds> {
    if (!account) throw new Error('Connect a wallet first')
    const message = authMessage()
    const { signature } = await signPersonalMessage({
      message: new TextEncoder().encode(message),
    })
    return { message, signature }
  }

  function authHeaders(creds: AuthCreds): Record<string, string> {
    if (!account) throw new Error('Connect a wallet first')
    return {
      'X-Wallet-Address': account.address,
      'X-Signature': creds.signature,
      'X-Message': creds.message,
    }
  }

  async function sendAuthed(creds: AuthCreds, path: string, method: string, body?: unknown) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders(creds) },
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

    // ----- writes -----
    // Idempotent org create (409 = already exists → fine).
    ensureOrg: (name: string) => authedFetch('/v1/orgs', 'POST', { name }),

    getOrg: (w: string) => get<Org>(`/v1/orgs/${w}`),

    createGroup: (w: string, name: string) =>
      authedFetch(`/v1/orgs/${w}/groups`, 'POST', { name }),

    listGroups: (w: string) => get<Group[]>(`/v1/orgs/${w}/groups`),

    addEmployee: (w: string, input: AddEmployeeInput) =>
      authedFetch(`/v1/orgs/${w}/employees`, 'POST', input),

    listEmployees: (w: string) => get<Employee[]>(`/v1/orgs/${w}/employees`),

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

    listEmployeeOrgs: (w: string) =>
      get<EmployeeOrgEntry[]>(`/v1/employee/orgs?wallet=${w}`),

    listEmployeeInvoices: (w: string, orgWallet?: string) =>
      get<Invoice[]>(`/v1/employee/invoices?wallet=${w}${orgWallet ? `&orgWallet=${orgWallet}` : ''}`),

    // Submit an invoice with one wallet signature. If a file is attached, the same
    // signature authorizes both the upload and the create (reused within the 60s TTL).
    submitInvoice: async (input: CreateInvoiceInput, file?: File | null) => {
      const creds = await signAuth()
      let attachment_key = input.attachment_key
      if (file) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`${API_BASE}/v1/employee/upload`, {
          method: 'POST',
          headers: authHeaders(creds),
          body: form,
        })
        if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`)
        attachment_key = ((await res.json()) as { key: string }).key
      }
      return sendAuthed(creds, '/v1/employee/invoices', 'POST', { ...input, attachment_key })
    },
  }
}
