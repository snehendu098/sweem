// Transaction builders + on-chain reads for the Sweem payroll loop.
// Reuses the exact move targets/arg shapes validated in scripts/src/e2e-split-pool.ts.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient, SuiObjectChange } from '@mysten/sui/jsonRpc'
import {
  CORE,
  ADAPTERS,
  PROTOCOL_CONFIG,
  PROTOCOL_REGISTRY,
  USDC,
  CLOCK,
  NAVI_LENDING_CORE_PKG,
  NAVI_STORAGE,
  NAVI_POOL_USDC,
  NAVI_INCENTIVE_V2,
  NAVI_INCENTIVE_V3,
  NAVI_PRICE_ORACLE,
  NAVI_ASSET_ID,
  SCALLOP_VERSION,
  SCALLOP_MARKET,
} from './sweem'

// USDC bucket name used by employee vaults (matches token_name passed on-chain).
const VAULT_TOKEN_NAME = 'USDC'
// Effectively-unbounded max draw for cover_claim_* — the move call self-caps to
// the caller's own shortfall, so a huge ceiling just means "drain as needed".
const COVER_MAX = 18_446_744_073_709_551_615n // u64::MAX

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

// navi::pool_invest_navi<USDC>(pool, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id, amount)
// If the pool has no stored Navi AccountCap yet, mint one (lending::create_account) and
// store it into the pool DOF in the SAME tx before investing.
export function investNaviTx(
  poolId: string,
  amountRaw: bigint,
  opts: { needsCap: boolean },
): Transaction {
  const tx = new Transaction()
  if (opts.needsCap) {
    const cap = tx.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
    tx.moveCall({
      target: `${ADAPTERS}::navi::store_pool_account_cap`,
      typeArguments: [USDC],
      arguments: [tx.object(poolId), cap],
    })
  }
  tx.moveCall({
    target: `${ADAPTERS}::navi::pool_invest_navi`,
    typeArguments: [USDC],
    arguments: [
      tx.object(poolId),
      tx.object(NAVI_STORAGE),
      tx.object(NAVI_POOL_USDC),
      tx.object(NAVI_INCENTIVE_V2),
      tx.object(NAVI_INCENTIVE_V3),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u8(NAVI_ASSET_ID),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// scallop::pool_invest_scallop<USDC>(pool, version, market, registry, clock, amount)
export function investScallopTx(poolId: string, amountRaw: bigint): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::scallop::pool_invest_scallop`,
    typeArguments: [USDC],
    arguments: [
      tx.object(poolId),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// True if the pool already holds a stored Navi AccountCap (NaviPoolCapKey DOF).
// When true the invest tx must NOT re-mint/store a cap.
export async function poolHasNaviCap(
  client: SuiJsonRpcClient,
  poolId: string,
): Promise<boolean> {
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: poolId, cursor: cursor ?? null })
    if (page.data.some((f) => f.objectType.includes('NaviPoolCapKey'))) return true
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return false
}

// ----- on-chain pool reads (for the org dashboard) -----

export interface PoolSummary {
  idleRaw: bigint            // pool.balance — liquid USDC not yet invested/claimed
  totalDepositedRaw: bigint  // cumulative funded (net of deposit fee)
  totalClaimedRaw: bigint    // cumulative claimed by employees
  weeklyCommittedRaw: bigint // Σ weekly stream rate (the coverage floor at 1 week)
}

const toBig = (v: unknown): bigint => {
  try { return BigInt((v as string | number) ?? 0) } catch { return 0n }
}

// StreamPool fields are flat strings: balance, total_deposited, total_claimed,
// total_weekly_committed.
export async function readPoolSummary(
  client: SuiJsonRpcClient,
  poolId: string,
): Promise<PoolSummary> {
  const obj = await client.getObject({ id: poolId, options: { showContent: true } })
  const content = obj.data?.content
  const f =
    content && content.dataType === 'moveObject'
      ? (content.fields as Record<string, unknown>)
      : {}
  return {
    idleRaw: toBig(f.balance),
    totalDepositedRaw: toBig(f.total_deposited),
    totalClaimedRaw: toBig(f.total_claimed),
    weeklyCommittedRaw: toBig(f.total_weekly_committed),
  }
}

export interface PoolInvestments {
  naviRaw: bigint
  scallopRaw: bigint
}

// Invested principal per protocol, read from the pool's position dynamic fields
// (NaviPoolPositionKey / ScallopPoolPositionKey → { deposited_value }).
export async function readPoolInvestments(
  client: SuiJsonRpcClient,
  poolId: string,
): Promise<PoolInvestments> {
  let naviRaw = 0n
  let scallopRaw = 0n
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: poolId, cursor: cursor ?? null })
    for (const field of page.data) {
      const isNavi = field.name.type.includes('NaviPoolPositionKey')
      const isScallop = field.name.type.includes('ScallopPoolPositionKey')
      if (!isNavi && !isScallop) continue
      const o = await client.getObject({ id: field.objectId, options: { showContent: true } })
      const c = o.data?.content
      // dynamic_field::Field content.fields = { id, name, value: { ...deposited_value } }
      // value may surface as {fields:{deposited_value}} or {deposited_value} depending on RPC.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value: any = c && c.dataType === 'moveObject' ? (c.fields as any).value : undefined
      const dv = value?.fields?.deposited_value ?? value?.deposited_value
      const raw = toBig(dv)
      if (isNavi) naviRaw = raw
      else scallopRaw = raw
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return { naviRaw, scallopRaw }
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

// ===================================================================
// EMPLOYEE (claimant) side — chain-first discovery + claim/vault flows.
// All discovery comes from on-chain state alone; no backend dependency.
// ===================================================================

// Discover every stream pool that has a StreamCreated<USDC> event for `employee`.
// Source of truth is the chain — paginates all events of that type and filters by
// parsedJson.employee. Returns distinct pool ids.
export async function findMyStreamPools(
  client: SuiJsonRpcClient,
  employee: string,
): Promise<string[]> {
  const ids = new Set<string>()
  let cursor: { txDigest: string; eventSeq: string } | null = null
  do {
    const page = await client.queryEvents({
      query: { MoveEventType: `${CORE}::stream_pool::StreamCreated<${USDC}>` },
      cursor,
      limit: 50,
    })
    for (const ev of page.data) {
      const j = ev.parsedJson as { employee?: string; pool_id?: string } | null
      if (j && j.employee === employee && j.pool_id) ids.add(j.pool_id)
    }
    cursor = page.hasNextPage ? (page.nextCursor ?? null) : null
  } while (cursor)
  return [...ids]
}

export interface StreamState {
  rateAmountRaw: bigint
  ratePeriodMs: bigint
  paused: boolean
  stopped: boolean
}

// Read a single employee's Stream row out of the pool's `streams` Table.
// pool.streams.fields.id.id is the Table's UID; the row is a dynamic field
// keyed by the employee address. Returns null if no stream exists.
export async function readStream(
  client: SuiJsonRpcClient,
  poolId: string,
  employee: string,
): Promise<StreamState | null> {
  const pool = await client.getObject({ id: poolId, options: { showContent: true } })
  const pc = pool.data?.content
  if (!pc || pc.dataType !== 'moveObject') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableId: string | undefined = (pc.fields as any)?.streams?.fields?.id?.id
  if (!tableId) return null

  let row
  try {
    row = await client.getDynamicFieldObject({
      parentId: tableId,
      name: { type: 'address', value: employee },
    })
  } catch {
    return null
  }
  const rc = row.data?.content
  if (!rc || rc.dataType !== 'moveObject') return null
  // dynamic_field::Field { id, name, value: Stream }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = (rc.fields as any)?.value?.fields ?? (rc.fields as any)?.value
  if (!v) return null
  // Option fields surface as null or { fields: { vec: [...] } } / value depending on RPC.
  const optSet = (o: unknown): boolean => {
    if (o == null) return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = o as any
    if (Array.isArray(a)) return a.length > 0
    if (Array.isArray(a?.vec)) return a.vec.length > 0
    if (Array.isArray(a?.fields?.vec)) return a.fields.vec.length > 0
    return true
  }
  return {
    rateAmountRaw: toBig(v.rate_amount),
    ratePeriodMs: toBig(v.rate_period_ms),
    paused: optSet(v.paused_at),
    stopped: optSet(v.stopped_at),
  }
}

// The org address that owns/controls a pool (pool.org field).
export async function readPoolOrg(client: SuiJsonRpcClient, poolId: string): Promise<string> {
  const obj = await client.getObject({ id: poolId, options: { showContent: true } })
  const c = obj.data?.content
  if (!c || c.dataType !== 'moveObject') return ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((c.fields as any)?.org as string) ?? ''
}

// First EmployeeVault owned by `owner`, or null. Vaults are owned (not shared).
export async function findMyVault(
  client: SuiJsonRpcClient,
  owner: string,
): Promise<string | null> {
  const res = await client.getOwnedObjects({
    owner,
    filter: { StructType: `${CORE}::employee_vault::EmployeeVault` },
    options: { showType: true },
  })
  return res.data[0]?.data?.objectId ?? null
}

export interface CoverOpts {
  coverNavi: boolean
  coverScallop: boolean
}

// Append cover_claim_from_* calls to a tx. Each is a no-op on-chain unless the
// pool's idle cash is short of the caller's claimable, and self-caps to the
// shortfall, so passing COVER_MAX is safe.
function appendCovers(tx: Transaction, poolId: string, opts: CoverOpts): void {
  if (opts.coverNavi) {
    tx.moveCall({
      target: `${ADAPTERS}::navi::cover_claim_from_navi`,
      typeArguments: [USDC],
      arguments: [
        tx.object(poolId),
        tx.object(NAVI_STORAGE),
        tx.object(NAVI_POOL_USDC),
        tx.object(NAVI_INCENTIVE_V2),
        tx.object(NAVI_INCENTIVE_V3),
        tx.object(NAVI_PRICE_ORACLE),
        tx.object(PROTOCOL_CONFIG),
        tx.object(CLOCK),
        tx.object(PROTOCOL_REGISTRY),
        tx.pure.u8(NAVI_ASSET_ID),
        tx.pure.u64(COVER_MAX),
      ],
    })
  }
  if (opts.coverScallop) {
    tx.moveCall({
      target: `${ADAPTERS}::scallop::cover_claim_from_scallop`,
      typeArguments: [USDC],
      arguments: [
        tx.object(poolId),
        tx.object(SCALLOP_VERSION),
        tx.object(SCALLOP_MARKET),
        tx.object(PROTOCOL_CONFIG),
        tx.object(PROTOCOL_REGISTRY),
        tx.object(CLOCK),
        tx.pure.u64(COVER_MAX),
      ],
    })
  }
}

// Claim accrued stream to the caller's wallet. Optionally tops up pool idle cash
// from Navi/Scallop first, then stream_pool::claim_and_keep<USDC>.
export function claimToWalletTx(poolId: string, covers: CoverOpts): Transaction {
  const tx = new Transaction()
  appendCovers(tx, poolId, covers)
  tx.moveCall({
    target: `${CORE}::stream_pool::claim_and_keep`,
    typeArguments: [USDC],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  return tx
}

// Claim accrued stream straight into the employee's vault USDC bucket.
// stream_pool::claim returns a Coin which is piped into deposit_to_bucket.
export function claimToVaultTx(poolId: string, vaultId: string, covers: CoverOpts): Transaction {
  const tx = new Transaction()
  appendCovers(tx, poolId, covers)
  const [coin] = tx.moveCall({
    target: `${CORE}::stream_pool::claim`,
    typeArguments: [USDC],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  tx.moveCall({
    target: `${CORE}::employee_vault::deposit_to_bucket`,
    typeArguments: [USDC],
    arguments: [tx.object(vaultId), tx.pure.string(VAULT_TOKEN_NAME), coin],
  })
  return tx
}

// employee_vault::create_and_keep — mints an EmployeeVault to the caller.
export function createVaultTx(): Transaction {
  const tx = new Transaction()
  tx.moveCall({ target: `${CORE}::employee_vault::create_and_keep`, arguments: [] })
  return tx
}

// employee_vault::init_bucket<USDC>(vault, "USDC") — one-time per token.
export function initBucketTx(vaultId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::employee_vault::init_bucket`,
    typeArguments: [USDC],
    arguments: [tx.object(vaultId), tx.pure.string(VAULT_TOKEN_NAME)],
  })
  return tx
}

// Invest idle USDC from the vault's bucket into Navi. If the vault has no stored
// Navi AccountCap yet, mint one (lending::create_account) and store it first.
export function vaultInvestNaviTx(
  vaultId: string,
  amountRaw: bigint,
  opts: { needsCap: boolean },
): Transaction {
  const tx = new Transaction()
  if (opts.needsCap) {
    const cap = tx.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
    tx.moveCall({
      target: `${ADAPTERS}::navi::store_vault_account_cap`, // NON-generic
      arguments: [tx.object(vaultId), cap],
    })
  }
  tx.moveCall({
    target: `${ADAPTERS}::navi::vault_invest_navi`,
    typeArguments: [USDC],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(VAULT_TOKEN_NAME),
      tx.object(NAVI_STORAGE),
      tx.object(NAVI_POOL_USDC),
      tx.object(NAVI_INCENTIVE_V2),
      tx.object(NAVI_INCENTIVE_V3),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u8(NAVI_ASSET_ID),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// Invest idle USDC from the vault's bucket into Scallop.
export function vaultInvestScallopTx(vaultId: string, amountRaw: bigint): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::scallop::vault_invest_scallop`,
    typeArguments: [USDC],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(VAULT_TOKEN_NAME),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// Locate the USDC TokenBucket dynamic-object-field object id under a vault.
async function findVaultBucketId(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<string | null> {
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: vaultId, cursor: cursor ?? null })
    const f = page.data.find((d) => d.objectType.includes('TokenBucket'))
    if (f) return f.objectId
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return null
}

// True if the vault's USDC bucket already holds a Navi AccountCap (NaviVaultCapKey).
export async function vaultHasNaviCap(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<boolean> {
  const bucketId = await findVaultBucketId(client, vaultId)
  if (!bucketId) return false
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: bucketId, cursor: cursor ?? null })
    if (page.data.some((d) => d.name.type.includes('NaviVaultCapKey'))) return true
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return false
}

export interface VaultInvestments {
  naviRaw: bigint
  scallopRaw: bigint
  idleRaw: bigint // liquid USDC sitting in the bucket, not yet invested
}

// Best-effort read of a vault's USDC bucket: invested principal per protocol
// (NaviVaultPositionKey / ScallopVaultPositionKey → deposited_value) plus the
// bucket's liquid balance. Returns zeros for anything missing.
export async function readVaultInvestments(
  client: SuiJsonRpcClient,
  vaultId: string,
): Promise<VaultInvestments> {
  const out: VaultInvestments = { naviRaw: 0n, scallopRaw: 0n, idleRaw: 0n }
  const bucketId = await findVaultBucketId(client, vaultId)
  if (!bucketId) return out

  try {
    const bucket = await client.getObject({ id: bucketId, options: { showContent: true } })
    const bc = bucket.data?.content
    if (bc && bc.dataType === 'moveObject') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.idleRaw = toBig((bc.fields as any)?.balance)
    }
  } catch {
    /* idle stays 0 */
  }

  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: bucketId, cursor: cursor ?? null })
    for (const field of page.data) {
      const isNavi = field.name.type.includes('NaviVaultPositionKey')
      const isScallop = field.name.type.includes('ScallopVaultPositionKey')
      if (!isNavi && !isScallop) continue
      try {
        const o = await client.getObject({ id: field.objectId, options: { showContent: true } })
        const c = o.data?.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value: any = c && c.dataType === 'moveObject' ? (c.fields as any).value : undefined
        const raw = toBig(value?.fields?.deposited_value ?? value?.deposited_value)
        if (isNavi) out.naviRaw = raw
        else out.scallopRaw = raw
      } catch {
        /* skip on read failure */
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return out
}

// Extract the created EmployeeVault object id from a tx response's objectChanges.
export function findCreatedVaultId(
  changes: SuiObjectChange[] | null | undefined,
): string | undefined {
  for (const c of changes ?? []) {
    if (c.type === 'created' && c.objectType.includes('::employee_vault::EmployeeVault'))
      return c.objectId
  }
  return undefined
}
