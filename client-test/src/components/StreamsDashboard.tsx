'use client'

import { useEffect, useState } from 'react'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import type { EmployeeRow } from './AddEmployees'
import { claimTx, readClaimable } from '@/lib/tx'
import { MONTH_MS, fromRaw, minClaimRaw, toRaw, WEEK_MS } from '@/lib/sweem'

export function StreamsDashboard({ poolId, employees }: { poolId: string; employees: EmployeeRow[] }) {
  const account = useCurrentAccount()
  const client = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  const [claimable, setClaimable] = useState<Record<string, bigint>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // Poll live claimable for every employee every 1.5s.
  useEffect(() => {
    let alive = true
    async function tick() {
      const entries = await Promise.all(
        employees.map(async (e) => [e.address, await readClaimable(client, poolId, e.address).catch(() => 0n)] as const),
      )
      if (alive) setClaimable(Object.fromEntries(entries))
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(id) }
  }, [client, poolId, employees])

  async function claim() {
    if (!account) return
    setBusy(account.address); setMsg(null)
    try {
      const { digest } = await signAndExecute({ transaction: claimTx(poolId) })
      const r = await client.waitForTransaction({ digest, options: { showEffects: true } })
      if (r.effects?.status?.status !== 'success') throw new Error(r.effects?.status?.error ?? 'claim failed')
      setMsg(`Claimed ✓ ${digest.slice(0, 10)}…`)
    } catch (e) {
      setMsg(`⚠ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold text-lg">3 · Live streams</h2>
      <p className="text-xs text-zinc-500">Claimable updates ~every 1.5s. A fresh stream can only be claimed after ~16.8h of accrual (10% of a week) — the button stays disabled until then.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-zinc-500">
          <tr><th>Employee</th><th>Rate</th><th>Claimable</th><th>Min to claim</th><th></th></tr>
        </thead>
        <tbody>
          {employees.map((e) => {
            const c = claimable[e.address] ?? 0n
            const min = minClaimRaw(toRaw(e.perMonth), BigInt(MONTH_MS))
            const ready = c >= min && min > 0n
            const isMe = account?.address === e.address
            // hours of accrual still needed (min - current) at this rate
            const ratePerMs = Number(toRaw(e.perMonth)) / MONTH_MS
            const etaH = ready ? 0 : ratePerMs > 0 ? (Number(min - c) / ratePerMs) / 3_600_000 : Infinity
            return (
              <tr key={e.address} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2">{e.alias || '—'}<br /><span className="font-mono text-[10px] text-zinc-500">{e.address.slice(0, 12)}…</span></td>
                <td>{e.perMonth} USDC/mo</td>
                <td className="font-medium">{fromRaw(c).toFixed(6)}</td>
                <td>{fromRaw(min).toFixed(6)}{!ready && etaH < Infinity && <span className="text-[10px] text-zinc-500"> (~{etaH.toFixed(1)}h)</span>}</td>
                <td>
                  <button
                    onClick={claim}
                    disabled={!isMe || !ready || busy === e.address}
                    title={!isMe ? 'connect this employee’s wallet to claim' : !ready ? 'not enough accrued yet' : ''}
                    className="rounded-full bg-foreground text-background px-3 py-1 text-xs disabled:opacity-30"
                  >
                    {busy === e.address ? '…' : 'Claim'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {msg && <p className="text-sm text-zinc-600 dark:text-zinc-300">{msg}</p>}
      <p className="text-[10px] text-zinc-400">WEEK_MS={WEEK_MS} · pool {poolId.slice(0, 10)}…</p>
    </section>
  )
}
