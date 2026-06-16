'use client'

import { useState } from 'react'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { createPoolTx, findCreatedPoolId } from '@/lib/tx'
import { useSweemApi } from '@/lib/api'

export function CreatePool({ onReady }: { onReady: (poolId: string, groupId: string, minWeeks: number) => void }) {
  const account = useCurrentAccount()
  const client = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const api = useSweemApi()

  const [orgName, setOrgName] = useState('Demo Org')
  const [groupName, setGroupName] = useState('Engineering')
  const [minWeeks, setMinWeeks] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const say = (m: string) => setLog((l) => [...l, m])

  async function go() {
    if (!account) return
    setBusy(true)
    setErr(null)
    setLog([])
    try {
      say('Registering org + group (backend)…')
      await api.ensureOrg(orgName)
      const group = await api.createGroup(account.address, groupName)
      const groupId = group.data?.id as string
      if (!groupId) throw new Error('no group id returned')

      say('Creating StreamPool on-chain (sign in wallet)…')
      const { digest } = await signAndExecute({ transaction: createPoolTx(minWeeks) })
      const r = await client.waitForTransaction({ digest, options: { showObjectChanges: true, showEffects: true } })
      if (r.effects?.status?.status !== 'success') throw new Error(r.effects?.status?.error ?? 'tx failed')
      const poolId = findCreatedPoolId(r.objectChanges)
      if (!poolId) throw new Error('could not find created pool id')
      say(`Pool created: ${poolId.slice(0, 10)}…`)

      say('Linking pool in backend…')
      await api.createPool(account.address, groupId, 'USDC', poolId)

      onReady(poolId, groupId, minWeeks)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold text-lg">1 · Create payroll pool</h2>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">Org name
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 bg-transparent" />
        </label>
        <label className="text-sm">Group
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 bg-transparent" />
        </label>
        <label className="text-sm">Min coverage weeks
          <input type="number" min={1} value={minWeeks} onChange={(e) => setMinWeeks(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded border px-2 py-1 bg-transparent" />
        </label>
      </div>
      <button onClick={go} disabled={busy || !account} className="rounded-full bg-foreground text-background px-5 h-10 disabled:opacity-40">
        {busy ? 'Working…' : 'Create pool (USDC)'}
      </button>
      {log.map((m, i) => <p key={i} className="text-xs text-zinc-500">• {m}</p>)}
      {err && <p className="text-sm text-red-500">⚠ {err}</p>}
    </section>
  )
}
