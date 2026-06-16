'use client'

import { useMemo, useState } from 'react'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { depositTx, type EmployeeStream } from '@/lib/tx'
import { useSweemApi } from '@/lib/api'
import { MONTH_MS, toRaw, weeklyCommitRaw, fromRaw } from '@/lib/sweem'

export interface EmployeeRow { alias: string; address: string; perMonth: number }

export function AddEmployees({
  orgWallet,
  groupId,
  poolId,
  minWeeks,
  onStreamed,
}: {
  orgWallet: string
  groupId: string
  poolId: string
  minWeeks: number
  onStreamed: (rows: EmployeeRow[]) => void
}) {
  const account = useCurrentAccount()
  const client = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const api = useSweemApi()

  const [rows, setRows] = useState<EmployeeRow[]>([
    { alias: 'Alice', address: account?.address ?? '', perMonth: 1 },
  ])
  const [deposit, setDeposit] = useState(3)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const say = (m: string) => setLog((l) => [...l, m])

  // Coverage floor = sum(ceil(rate*WEEK/period)) * minWeeks. Deposit must be ≥ this.
  const floorRaw = useMemo(
    () => rows.reduce((acc, r) => acc + weeklyCommitRaw(toRaw(r.perMonth), BigInt(MONTH_MS)), 0n) * BigInt(minWeeks),
    [rows, minWeeks],
  )
  const floorUsdc = fromRaw(floorRaw)

  const setRow = (i: number, patch: Partial<EmployeeRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function go() {
    if (!account) return
    setBusy(true); setErr(null); setLog([])
    try {
      const clean = rows.filter((r) => r.address && r.perMonth > 0)
      if (clean.length === 0) throw new Error('add at least one employee with an address + rate')
      if (deposit < floorUsdc) throw new Error(`deposit ${deposit} < coverage floor ${floorUsdc.toFixed(4)} USDC`)

      const streams: EmployeeStream[] = clean.map((r) => ({
        address: r.address,
        rateRaw: toRaw(r.perMonth),
        periodMs: BigInt(MONTH_MS),
      }))

      say('Funding pool + creating streams (sign in wallet)…')
      const { digest } = await signAndExecute({ transaction: depositTx(poolId, toRaw(deposit), streams) })
      const r = await client.waitForTransaction({ digest, options: { showEffects: true } })
      if (r.effects?.status?.status !== 'success') throw new Error(r.effects?.status?.error ?? 'deposit failed')
      say('Deposit confirmed — streaming live.')

      say('Persisting employees (backend)…')
      for (const e of clean) {
        await api.addEmployee(orgWallet, groupId, e.alias, e.address, [
          { token: 'USDC', rate_amount: e.perMonth, rate_type: 'MONTHLY' },
        ])
      }
      onStreamed(clean)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold text-lg">2 · Add employees &amp; stream</h2>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-center">
            <input placeholder="alias" value={r.alias} onChange={(e) => setRow(i, { alias: e.target.value })} className="rounded border px-2 py-1 bg-transparent text-sm" />
            <input placeholder="0x… employee address" value={r.address} onChange={(e) => setRow(i, { address: e.target.value })} className="rounded border px-2 py-1 bg-transparent text-sm font-mono" />
            <input type="number" min={0} step={0.1} value={r.perMonth} onChange={(e) => setRow(i, { perMonth: Number(e.target.value) })} className="w-24 rounded border px-2 py-1 bg-transparent text-sm" />
            <span className="text-xs text-zinc-500">USDC/mo</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => setRows((rs) => [...rs, { alias: '', address: '', perMonth: 1 }])} className="text-sm rounded border px-3 py-1">+ employee</button>
        <button onClick={() => account && setRows((rs) => rs.length ? rs.map((r, j) => j === rs.length - 1 ? { ...r, address: account.address } : r) : rs)} className="text-sm rounded border px-3 py-1">use my address</button>
      </div>
      <label className="text-sm block">Total deposit (USDC) — must cover ≥ {floorUsdc.toFixed(4)} (floor)
        <input type="number" min={0} step={0.1} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} className="mt-1 w-40 rounded border px-2 py-1 bg-transparent block" />
      </label>
      <button onClick={go} disabled={busy || !account} className="rounded-full bg-foreground text-background px-5 h-10 disabled:opacity-40">
        {busy ? 'Working…' : 'Fund & start streaming'}
      </button>
      {log.map((m, i) => <p key={i} className="text-xs text-zinc-500">• {m}</p>)}
      {err && <p className="text-sm text-red-500">⚠ {err}</p>}
    </section>
  )
}
