'use client'

import { useState } from 'react'
import { ConnectButton, useCurrentAccount, useSuiClientQuery } from '@mysten/dapp-kit'
import { CreatePool } from '@/components/CreatePool'
import { AddEmployees, type EmployeeRow } from '@/components/AddEmployees'
import { StreamsDashboard } from '@/components/StreamsDashboard'
import { USDC, fromRaw } from '@/lib/sweem'

function UsdcBalance({ address }: { address: string }) {
  const { data } = useSuiClientQuery('getBalance', { owner: address, coinType: USDC })
  return <span className="text-sm text-zinc-500">USDC: {data ? fromRaw(data.totalBalance).toFixed(4) : '…'}</span>
}

export default function Home() {
  const account = useCurrentAccount()
  const [pool, setPool] = useState<{ poolId: string; groupId: string; minWeeks: number } | null>(null)
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null)

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sweem demo — streaming payroll</h1>
          <p className="text-sm text-zinc-500">create pool → add employees → stream → claim · mainnet</p>
        </div>
        <ConnectButton />
      </header>

      {account && (
        <div className="flex gap-4 text-sm">
          <span className="font-mono text-zinc-500">{account.address.slice(0, 14)}…</span>
          <UsdcBalance address={account.address} />
        </div>
      )}

      {!account && <p className="text-zinc-500">Connect a wallet (holding a little USDC + SUI for gas) to begin.</p>}

      {account && !pool && (
        <CreatePool onReady={(poolId, groupId, minWeeks) => setPool({ poolId, groupId, minWeeks })} />
      )}

      {account && pool && (
        <>
          <p className="text-xs text-zinc-500">Pool <span className="font-mono">{pool.poolId.slice(0, 12)}…</span> ready.</p>
          {!employees && (
            <AddEmployees
              orgWallet={account.address}
              groupId={pool.groupId}
              poolId={pool.poolId}
              minWeeks={pool.minWeeks}
              onStreamed={setEmployees}
            />
          )}
          {employees && <StreamsDashboard poolId={pool.poolId} employees={employees} />}
        </>
      )}
    </main>
  )
}
