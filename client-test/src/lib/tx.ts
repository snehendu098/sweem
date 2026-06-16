// Transaction builders + on-chain reads for the Sweem payroll loop.
// Reuses the exact move targets/arg shapes validated in scripts/src/e2e-split-pool.ts.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient, SuiObjectChange } from '@mysten/sui/jsonRpc'
import { CORE, PROTOCOL_CONFIG, USDC, CLOCK } from './sweem'

export interface EmployeeStream {
  address: string
  rateRaw: bigint // tokens (raw 6dp) per period
  periodMs: bigint // rate period in ms
}

// stream_pool::create_and_share<USDC>(min_coverage_weeks)
export function createPoolTx(minCoverageWeeks: number): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::create_and_share`,
    typeArguments: [USDC],
    arguments: [tx.pure.u64(BigInt(minCoverageWeeks))],
  })
  return tx
}

// stream_pool::deposit<USDC>(pool, config, payment, employees, rate_amounts, rate_periods_ms, clock)
// Funds the pool AND creates/updates each employee's stream — this is the "start streaming" call.
export function depositTx(
  poolId: string,
  totalDepositRaw: bigint,
  employees: EmployeeStream[],
): Transaction {
  const tx = new Transaction()
  // coinWithBalance auto-selects/merges the sender's USDC coins at build time.
  const pay = coinWithBalance({ type: USDC, balance: totalDepositRaw })
  tx.moveCall({
    target: `${CORE}::stream_pool::deposit`,
    typeArguments: [USDC],
    arguments: [
      tx.object(poolId),
      tx.object(PROTOCOL_CONFIG),
      pay,
      tx.makeMoveVec({ type: 'address', elements: employees.map((e) => tx.pure.address(e.address)) }),
      tx.makeMoveVec({ type: 'u128', elements: employees.map((e) => tx.pure.u128(e.rateRaw)) }),
      tx.makeMoveVec({ type: 'u64', elements: employees.map((e) => tx.pure.u64(e.periodMs)) }),
      tx.object(CLOCK),
    ],
  })
  return tx
}

// stream_pool::claim_and_keep<USDC>(pool, clock) — entry; transfers claimed Coin to the caller.
export function claimTx(poolId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::claim_and_keep`,
    typeArguments: [USDC],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  return tx
}

// Extract the created StreamPool object id from a tx response's objectChanges.
export function findCreatedPoolId(changes: SuiObjectChange[] | null | undefined): string | undefined {
  for (const c of changes ?? []) {
    if (c.type === 'created' && c.objectType.includes('::stream_pool::StreamPool')) return c.objectId
  }
  return undefined
}

// Live read: stream_pool::claimable_amount<USDC>(pool, employee, clock) -> u64 (raw).
// Uses devInspect (no gas, no signature).
export async function readClaimable(
  client: SuiJsonRpcClient,
  poolId: string,
  employee: string,
): Promise<bigint> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::claimable_amount`,
    typeArguments: [USDC],
    arguments: [tx.object(poolId), tx.pure.address(employee), tx.object(CLOCK)],
  })
  const res = await client.devInspectTransactionBlock({ sender: employee, transactionBlock: tx })
  const rv = res.results?.[0]?.returnValues?.[0]
  if (!rv) return 0n
  const [bytes] = rv // [number[], typeTag]
  return BigInt(bcs.u64().parse(Uint8Array.from(bytes)))
}
