'use client'

// Thin client for sweem-server. Writes are authenticated with a wallet
// personal-message signature matching the backend contract in src/lib/auth.ts:
//   message = `sweem:<rand>:<rand>:<unixSeconds>`  (TTL 60s)
// sent as headers X-Wallet-Address / X-Signature / X-Message.

import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit'
import { API_BASE } from './sweem'

function authMessage(): string {
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `sweem:${rand()}:${rand()}:${Math.floor(Date.now() / 1000)}`
}

export interface RateInput {
  token: string
  rate_amount: number
  rate_type: 'MONTHLY' | 'HOURLY'
}

export function useSweemApi() {
  const account = useCurrentAccount()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()

  async function authedFetch(path: string, method: string, body?: unknown) {
    if (!account) throw new Error('Connect a wallet first')
    const message = authMessage()
    const { signature } = await signPersonalMessage({
      message: new TextEncoder().encode(message),
    })
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Wallet-Address': account.address,
        'X-Signature': signature,
        'X-Message': message,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && res.status !== 409) {
      throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`)
    }
    return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) }
  }

  async function get(path: string) {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
    return res.json()
  }

  return {
    address: account?.address,

    // Idempotent org create (409 = already exists → fine).
    ensureOrg: (name: string) => authedFetch('/v1/orgs', 'POST', { name }),

    createGroup: (wallet: string, name: string) =>
      authedFetch(`/v1/orgs/${wallet}/groups`, 'POST', { name }),

    createPool: (wallet: string, groupId: string, token: string, onChainPoolId: string) =>
      authedFetch(`/v1/orgs/${wallet}/groups/${groupId}/pools`, 'POST', {
        token,
        on_chain_pool_id: onChainPoolId,
      }),

    addEmployee: (
      wallet: string,
      groupId: string,
      alias: string,
      employeeWallet: string,
      rates: RateInput[],
    ) =>
      authedFetch(`/v1/orgs/${wallet}/groups/${groupId}/employees`, 'POST', {
        alias,
        wallet_address: employeeWallet,
        rates,
      }),

    listEmployees: (wallet: string, groupId: string) =>
      get(`/v1/orgs/${wallet}/groups/${groupId}/employees`),
  }
}
