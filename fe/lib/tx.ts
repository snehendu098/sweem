// Transaction builders + on-chain reads for the Sweem payroll loop.
// Every builder is token-aware: pass a TokenConfig (defaults to USDC) and it threads
// the coin type, vault bucket name, and Navi pool/asset through the move calls.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient, SuiObjectChange } from '@mysten/sui/jsonRpc'
import {
  CORE,
  ADAPTERS,
  PROTOCOL_CONFIG,
  PROTOCOL_REGISTRY,
  CLOCK,
  NAVI_LENDING_CORE_PKG,
  NAVI_STORAGE,
  NAVI_INCENTIVE_V2,
  NAVI_INCENTIVE_V3,
  NAVI_PRICE_ORACLE,
  SCALLOP_VERSION,
  SCALLOP_MARKET,
} from './sweem'
import { TOKENS, SUPPORTED_TOKENS, type TokenConfig } from './tokens'

// Effectively-unbounded max draw for cover_claim_* — the move call self-caps to
// the caller's own shortfall, so a huge ceiling just means "drain as needed".
const COVER_MAX = 18_446_744_073_709_551_615n // u64::MAX

// The `::module::Name` tail of a coin type — disambiguates a vault's per-token
// buckets without depending on address normalization (0x2 vs 0x000…0002).
const coinTail = (t: TokenConfig) => t.coinType.slice(t.coinType.indexOf('::'))
const isBucketOf = (objectType: string, t: TokenConfig) =>
  objectType.includes('TokenBucket') && objectType.includes(coinTail(t))

export interface EmployeeStream {
  address: string
  rateRaw: bigint // tokens (raw base units) per period
  periodMs: bigint // rate period in ms
}

// stream_pool::create_and_share<T>(min_coverage_weeks)
export function createPoolTx(minCoverageWeeks: number, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::create_and_share`,
    typeArguments: [token.coinType],
    arguments: [tx.pure.u64(BigInt(minCoverageWeeks))],
  })
  return tx
}

// Plain coin transfer — pay an invoice off the org's wallet to the employee.
// coinWithBalance auto-selects/merges (and splits from gas for SUI).
export function payInvoiceTx(recipient: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  const pay = coinWithBalance({ type: token.coinType, balance: amountRaw })
  tx.transferObjects([pay], tx.pure.address(recipient))
  return tx
}

// stream_pool::deposit<T>(pool, config, payment, employees, rate_amounts, rate_periods_ms, clock)
// Funds the pool AND creates/updates each employee's stream — the "start streaming" call.
export function depositTx(
  poolId: string,
  totalDepositRaw: bigint,
  employees: EmployeeStream[],
  token: TokenConfig = TOKENS.USDC,
): Transaction {
  const tx = new Transaction()
  const pay = coinWithBalance({ type: token.coinType, balance: totalDepositRaw })
  tx.moveCall({
    target: `${CORE}::stream_pool::deposit`,
    typeArguments: [token.coinType],
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

// stream_pool::claim_and_keep<T>(pool, clock) — entry; transfers claimed Coin to the caller.
export function claimTx(poolId: string, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::claim_and_keep`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  return tx
}

// stream_pool::pause_stream<T>(pool, employee, clock) — org/PauserRole; freezes accrual.
export function pauseStreamTx(poolId: string, employee: string, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::pause_stream`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.pure.address(employee), tx.object(CLOCK)],
  })
  return tx
}

// stream_pool::resume_stream<T>(pool, employee, clock) — org/PauserRole; resumes accrual.
export function resumeStreamTx(poolId: string, employee: string, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::resume_stream`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.pure.address(employee), tx.object(CLOCK)],
  })
  return tx
}

// ----- pool position moves (idle ⇄ Navi ⇄ Scallop), shared by invest + rebalance -----

// navi::pool_invest_navi<T> — idle → Navi. Mints + stores a Navi AccountCap first
// when the pool has none yet.
function appendPoolInvestNavi(
  tx: Transaction,
  poolId: string,
  amountRaw: bigint,
  token: TokenConfig,
  needsCap: boolean,
): void {
  if (needsCap) {
    const cap = tx.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
    tx.moveCall({
      target: `${ADAPTERS}::navi::store_pool_account_cap`,
      typeArguments: [token.coinType],
      arguments: [tx.object(poolId), cap],
    })
  }
  tx.moveCall({
    target: `${ADAPTERS}::navi::pool_invest_navi`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(poolId),
      tx.object(NAVI_STORAGE),
      tx.object(token.navi.poolId),
      tx.object(NAVI_INCENTIVE_V2),
      tx.object(NAVI_INCENTIVE_V3),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u8(token.navi.assetId),
      tx.pure.u64(amountRaw),
    ],
  })
}

// scallop::pool_invest_scallop<T> — idle → Scallop.
function appendPoolInvestScallop(tx: Transaction, poolId: string, amountRaw: bigint, token: TokenConfig): void {
  tx.moveCall({
    target: `${ADAPTERS}::scallop::pool_invest_scallop`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(poolId),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
}

// navi::org_withdraw_navi<T> — Navi → idle (back into the pool balance).
function appendOrgWithdrawNavi(tx: Transaction, poolId: string, amountRaw: bigint, token: TokenConfig): void {
  tx.moveCall({
    target: `${ADAPTERS}::navi::org_withdraw_navi`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(poolId),
      tx.object(NAVI_STORAGE),
      tx.object(token.navi.poolId),
      tx.object(NAVI_INCENTIVE_V2),
      tx.object(NAVI_INCENTIVE_V3),
      tx.object(NAVI_PRICE_ORACLE),
      tx.object(PROTOCOL_CONFIG),
      tx.object(CLOCK),
      tx.object(PROTOCOL_REGISTRY),
      tx.pure.u8(token.navi.assetId),
      tx.pure.u64(amountRaw),
    ],
  })
}

// scallop::org_withdraw_scallop<T> — Scallop → idle (back into the pool balance).
function appendOrgWithdrawScallop(tx: Transaction, poolId: string, amountRaw: bigint, token: TokenConfig): void {
  tx.moveCall({
    target: `${ADAPTERS}::scallop::org_withdraw_scallop`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(poolId),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_CONFIG),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
}

export function investNaviTx(
  poolId: string,
  amountRaw: bigint,
  opts: { needsCap: boolean },
  token: TokenConfig = TOKENS.USDC,
): Transaction {
  const tx = new Transaction()
  appendPoolInvestNavi(tx, poolId, amountRaw, token, opts.needsCap)
  return tx
}

export function investScallopTx(poolId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  appendPoolInvestScallop(tx, poolId, amountRaw, token)
  return tx
}

// Where a pool's funds can sit. Rebalancing moves `amountRaw` between any two of these.
export type PoolBucket = 'idle' | 'navi' | 'scallop'

// Move `amountRaw` from one bucket to another in a single PTB. A protocol→protocol
// move first withdraws to idle, then invests idle into the destination.
export function rebalanceTx(opts: {
  poolId: string
  token: TokenConfig
  from: PoolBucket
  to: PoolBucket
  amountRaw: bigint
  needsNaviCap: boolean
}): Transaction {
  const { poolId, token, from, to, amountRaw, needsNaviCap } = opts
  const tx = new Transaction()
  if (from === 'navi') appendOrgWithdrawNavi(tx, poolId, amountRaw, token)
  else if (from === 'scallop') appendOrgWithdrawScallop(tx, poolId, amountRaw, token)
  if (to === 'navi') appendPoolInvestNavi(tx, poolId, amountRaw, token, needsNaviCap)
  else if (to === 'scallop') appendPoolInvestScallop(tx, poolId, amountRaw, token)
  return tx
}

// stream_pool::topup<T>(pool, config, payment) — add more funds to the pool's idle
// balance (net of the deposit fee) without touching any stream.
export function topupTx(poolId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  const pay = coinWithBalance({ type: token.coinType, balance: amountRaw })
  tx.moveCall({
    target: `${CORE}::stream_pool::topup`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(PROTOCOL_CONFIG), pay],
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
  idleRaw: bigint            // pool.balance — liquid token not yet invested/claimed
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

// Live read: stream_pool::claimable_amount<T>(pool, employee, clock) -> u64 (raw).
// Uses devInspect (no gas, no signature).
export async function readClaimable(
  client: SuiJsonRpcClient,
  poolId: string,
  employee: string,
  token: TokenConfig = TOKENS.USDC,
): Promise<bigint> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::stream_pool::claimable_amount`,
    typeArguments: [token.coinType],
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

export interface DiscoveredPool {
  poolId: string
  token: TokenConfig
}

// Discover every stream pool that has a StreamCreated<T> event for `employee`,
// across all supported tokens. Each pool is tagged with its token so the caller
// knows which coin type / decimals to use.
export async function findMyStreamPools(
  client: SuiJsonRpcClient,
  employee: string,
  tokens: TokenConfig[] = SUPPORTED_TOKENS,
): Promise<DiscoveredPool[]> {
  const out: DiscoveredPool[] = []
  for (const token of tokens) {
    const ids = new Set<string>()
    let cursor: { txDigest: string; eventSeq: string } | null = null
    do {
      const page = await client.queryEvents({
        query: { MoveEventType: `${CORE}::stream_pool::StreamCreated<${token.coinType}>` },
        cursor,
        limit: 50,
      })
      for (const ev of page.data) {
        const j = ev.parsedJson as { employee?: string; pool_id?: string } | null
        if (j && j.employee === employee && j.pool_id) ids.add(j.pool_id)
      }
      cursor = page.hasNextPage ? (page.nextCursor ?? null) : null
    } while (cursor)
    for (const poolId of ids) out.push({ poolId, token })
  }
  return out
}

export interface StreamState {
  rateAmountRaw: bigint
  ratePeriodMs: bigint
  paused: boolean
  stopped: boolean
}

const optSet = (o: unknown): boolean => {
  if (o == null) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = o as any
  if (Array.isArray(a)) return a.length > 0
  if (Array.isArray(a?.vec)) return a.vec.length > 0
  if (Array.isArray(a?.fields?.vec)) return a.fields.vec.length > 0
  return true
}

// Read a single employee's Stream row out of the pool's `streams` Table.
// Returns null if no stream exists. Stream rows are token-agnostic on read.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: any = (rc.fields as any)?.value?.fields ?? (rc.fields as any)?.value
  if (!v) return null
  return {
    rateAmountRaw: toBig(v.rate_amount),
    ratePeriodMs: toBig(v.rate_period_ms),
    paused: optSet(v.paused_at),
    stopped: optSet(v.stopped_at),
  }
}

// Batch read paused/stopped status for many employees in one pass.
export async function readStreamStatuses(
  client: SuiJsonRpcClient,
  poolId: string,
  employees: string[],
): Promise<Record<string, { paused: boolean; stopped: boolean }>> {
  const out: Record<string, { paused: boolean; stopped: boolean }> = {}
  const pool = await client.getObject({ id: poolId, options: { showContent: true } })
  const pc = pool.data?.content
  if (!pc || pc.dataType !== 'moveObject') return out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableId: string | undefined = (pc.fields as any)?.streams?.fields?.id?.id
  if (!tableId) return out

  await Promise.all(
    employees.map(async (employee) => {
      try {
        const row = await client.getDynamicFieldObject({
          parentId: tableId,
          name: { type: 'address', value: employee },
        })
        const rc = row.data?.content
        if (!rc || rc.dataType !== 'moveObject') return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v: any = (rc.fields as any)?.value?.fields ?? (rc.fields as any)?.value
        if (!v) return
        out[employee] = { paused: optSet(v.paused_at), stopped: optSet(v.stopped_at) }
      } catch {
        /* no stream row for this employee */
      }
    }),
  )
  return out
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
function appendCovers(tx: Transaction, poolId: string, opts: CoverOpts, token: TokenConfig): void {
  if (opts.coverNavi) {
    tx.moveCall({
      target: `${ADAPTERS}::navi::cover_claim_from_navi`,
      typeArguments: [token.coinType],
      arguments: [
        tx.object(poolId),
        tx.object(NAVI_STORAGE),
        tx.object(token.navi.poolId),
        tx.object(NAVI_INCENTIVE_V2),
        tx.object(NAVI_INCENTIVE_V3),
        tx.object(NAVI_PRICE_ORACLE),
        tx.object(PROTOCOL_CONFIG),
        tx.object(CLOCK),
        tx.object(PROTOCOL_REGISTRY),
        tx.pure.u8(token.navi.assetId),
        tx.pure.u64(COVER_MAX),
      ],
    })
  }
  if (opts.coverScallop) {
    tx.moveCall({
      target: `${ADAPTERS}::scallop::cover_claim_from_scallop`,
      typeArguments: [token.coinType],
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
// from Navi/Scallop first, then stream_pool::claim_and_keep<T>.
export function claimToWalletTx(poolId: string, covers: CoverOpts, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  appendCovers(tx, poolId, covers, token)
  tx.moveCall({
    target: `${CORE}::stream_pool::claim_and_keep`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  return tx
}

// Claim accrued stream straight into the employee's vault bucket for this token.
export function claimToVaultTx(
  poolId: string,
  vaultId: string,
  covers: CoverOpts,
  token: TokenConfig = TOKENS.USDC,
): Transaction {
  const tx = new Transaction()
  appendCovers(tx, poolId, covers, token)
  const [coin] = tx.moveCall({
    target: `${CORE}::stream_pool::claim`,
    typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(CLOCK)],
  })
  tx.moveCall({
    target: `${CORE}::employee_vault::deposit_to_bucket`,
    typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), coin],
  })
  return tx
}

// One-PTB "Claim & Allocate": claim the full accrued stream, route a slice into the
// vault bucket (optionally investing the Navi/Scallop legs by amount), and send the
// remainder — cash + accrual dust — back to the employee's wallet. Percentages are
// resolved to base-unit amounts off-chain by the caller; the wallet leg is implicit
// (whatever's left after the bucket deposit), so it absorbs all rounding.
export interface AllocPlan {
  poolId: string
  vaultId: string | null // required when bucketDepositRaw > 0
  wallet: string // recipient of the cash remainder
  token: TokenConfig
  covers: CoverOpts
  bucketDepositRaw: bigint // total routed into the vault bucket (idle + navi + scallop legs)
  naviInvestRaw: bigint // portion of the bucket pushed into Navi (0 = leave idle)
  scallopInvestRaw: bigint // portion of the bucket pushed into Scallop (0 = leave idle)
  needsBucket: boolean // init the token bucket first (vault has none yet)
  needsNaviCap: boolean // mint + store a Navi AccountCap first
}

export function claimAndAllocateTx(plan: AllocPlan): Transaction {
  const { token } = plan
  const tx = new Transaction()
  appendCovers(tx, plan.poolId, plan.covers, token)
  const [coin] = tx.moveCall({
    target: `${CORE}::stream_pool::claim`,
    typeArguments: [token.coinType],
    arguments: [tx.object(plan.poolId), tx.object(CLOCK)],
  })

  if (plan.bucketDepositRaw > 0n) {
    if (!plan.vaultId) throw new Error('A vault is required to allocate into the vault')
    const vault = tx.object(plan.vaultId)
    if (plan.needsBucket) {
      tx.moveCall({
        target: `${CORE}::employee_vault::init_bucket`,
        typeArguments: [token.coinType],
        arguments: [vault, tx.pure.string(token.bucketName)],
      })
    }
    const [vaultCoin] = tx.splitCoins(coin, [tx.pure.u64(plan.bucketDepositRaw)])
    tx.moveCall({
      target: `${CORE}::employee_vault::deposit_to_bucket`,
      typeArguments: [token.coinType],
      arguments: [vault, tx.pure.string(token.bucketName), vaultCoin],
    })
    if (plan.naviInvestRaw > 0n) {
      if (plan.needsNaviCap) {
        const cap = tx.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
        tx.moveCall({
          target: `${ADAPTERS}::navi::store_vault_account_cap`, // NON-generic
          arguments: [vault, cap],
        })
      }
      tx.moveCall({
        target: `${ADAPTERS}::navi::vault_invest_navi`,
        typeArguments: [token.coinType],
        arguments: [
          vault,
          tx.pure.string(token.bucketName),
          tx.object(NAVI_STORAGE),
          tx.object(token.navi.poolId),
          tx.object(NAVI_INCENTIVE_V2),
          tx.object(NAVI_INCENTIVE_V3),
          tx.object(PROTOCOL_REGISTRY),
          tx.object(CLOCK),
          tx.pure.u8(token.navi.assetId),
          tx.pure.u64(plan.naviInvestRaw),
        ],
      })
    }
    if (plan.scallopInvestRaw > 0n) {
      tx.moveCall({
        target: `${ADAPTERS}::scallop::vault_invest_scallop`,
        typeArguments: [token.coinType],
        arguments: [
          vault,
          tx.pure.string(token.bucketName),
          tx.object(SCALLOP_VERSION),
          tx.object(SCALLOP_MARKET),
          tx.object(PROTOCOL_REGISTRY),
          tx.object(CLOCK),
          tx.pure.u64(plan.scallopInvestRaw),
        ],
      })
    }
  }

  // Remainder (cash + accrual dust) goes to the employee.
  tx.transferObjects([coin], tx.pure.address(plan.wallet))
  return tx
}

// True if the vault already holds a TokenBucket for this token (deposit_to_bucket
// aborts without it; init_bucket aborts if it already exists — callers must know).
export async function vaultHasBucket(
  client: SuiJsonRpcClient,
  vaultId: string,
  token: TokenConfig = TOKENS.USDC,
): Promise<boolean> {
  return (await findVaultBucketId(client, vaultId, token)) !== null
}

// employee_vault::create_and_keep — mints an EmployeeVault to the caller.
export function createVaultTx(): Transaction {
  const tx = new Transaction()
  tx.moveCall({ target: `${CORE}::employee_vault::create_and_keep`, arguments: [] })
  return tx
}

// employee_vault::init_bucket<T>(vault, bucketName) — one-time per token.
export function initBucketTx(vaultId: string, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${CORE}::employee_vault::init_bucket`,
    typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName)],
  })
  return tx
}

// Invest idle tokens from the vault's bucket into Navi. If the vault has no stored
// Navi AccountCap yet, mint one (lending::create_account) and store it first.
export function vaultInvestNaviTx(
  vaultId: string,
  amountRaw: bigint,
  opts: { needsCap: boolean },
  token: TokenConfig = TOKENS.USDC,
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
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(NAVI_STORAGE),
      tx.object(token.navi.poolId),
      tx.object(NAVI_INCENTIVE_V2),
      tx.object(NAVI_INCENTIVE_V3),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u8(token.navi.assetId),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// Invest idle tokens from the vault's bucket into Scallop.
export function vaultInvestScallopTx(vaultId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::scallop::vault_invest_scallop`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// Locate this token's TokenBucket dynamic-object-field object id under a vault.
async function findVaultBucketId(
  client: SuiJsonRpcClient,
  vaultId: string,
  token: TokenConfig,
): Promise<string | null> {
  let cursor: string | null | undefined = null
  do {
    const page = await client.getDynamicFields({ parentId: vaultId, cursor: cursor ?? null })
    const f = page.data.find((d) => isBucketOf(d.objectType, token))
    if (f) return f.objectId
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return null
}

// True if this token's vault bucket already holds a Navi AccountCap (NaviVaultCapKey).
export async function vaultHasNaviCap(
  client: SuiJsonRpcClient,
  vaultId: string,
  token: TokenConfig = TOKENS.USDC,
): Promise<boolean> {
  const bucketId = await findVaultBucketId(client, vaultId, token)
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
  idleRaw: bigint // liquid tokens sitting in the bucket, not yet invested
}

// Best-effort read of a vault's bucket for this token: invested principal per
// protocol (NaviVaultPositionKey / ScallopVaultPositionKey → deposited_value) plus
// the bucket's liquid balance. Returns zeros for anything missing.
export async function readVaultInvestments(
  client: SuiJsonRpcClient,
  vaultId: string,
  token: TokenConfig = TOKENS.USDC,
): Promise<VaultInvestments> {
  const out: VaultInvestments = { naviRaw: 0n, scallopRaw: 0n, idleRaw: 0n }
  const bucketId = await findVaultBucketId(client, vaultId, token)
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

// ----- recent activity (org dashboard home) -----

export interface ActivityRow {
  kind: 'claim' | 'funded'
  party: string // employee (claim) or org (funded)
  amountRaw: bigint
  token: TokenConfig
  timestampMs: number
  digest: string
}

// Best-effort recent activity: FundsClaimed + PoolFunded events across all tokens,
// newest first. When `poolId` is given the feed is scoped to that pool; pass null
// for a global feed. Never throws — returns [] on any read failure.
export async function readRecentActivity(
  client: SuiJsonRpcClient,
  poolId: string | null,
  limit = 8,
  tokens: TokenConfig[] = SUPPORTED_TOKENS,
): Promise<ActivityRow[]> {
  const out: ActivityRow[] = []
  const pull = async (
    token: TokenConfig,
    event: string,
    kind: ActivityRow['kind'],
    partyKey: string,
  ) => {
    try {
      const page = await client.queryEvents({
        query: { MoveEventType: `${CORE}::stream_pool::${event}<${token.coinType}>` },
        limit: 25,
        order: 'descending',
      })
      for (const ev of page.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j = ev.parsedJson as any
        if (!j) continue
        if (poolId && j.pool_id !== poolId) continue
        out.push({
          kind,
          party: (j[partyKey] as string) ?? '',
          amountRaw: toBig(j.amount ?? j.net),
          token,
          timestampMs: Number(j.timestamp ?? 0),
          digest: ev.id.txDigest,
        })
      }
    } catch {
      /* ignore — best effort */
    }
  }
  await Promise.all(
    tokens.flatMap((token) => [
      pull(token, 'FundsClaimed', 'claim', 'employee'),
      pull(token, 'PoolFunded', 'funded', 'org'),
    ]),
  )
  out.sort((a, b) => b.timestampMs - a.timestampMs)
  return out.slice(0, limit)
}
