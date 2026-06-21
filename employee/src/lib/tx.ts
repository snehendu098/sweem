// Transaction builders + on-chain reads for the Sweem payroll loop.
// Every builder is token-aware: pass a TokenConfig (defaults to USDC) and it threads
// the coin type, vault bucket name, and Navi pool/asset through the move calls.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient, SuiObjectChange } from '@mysten/sui/jsonRpc'
import {
  CORE,
  ADAPTERS,
  ADAPTERS_STSUI,
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
  SUILEND_LENDING_MARKET,
  STSUI_LST_INFO,
  STSUI_SYSTEM_STATE,
  USDY_TYPE,
} from './sweem'
import { TOKENS, SUPPORTED_TOKENS, type TokenConfig } from './tokens'
import { appendCetusSwap } from './cetus'

// Default Cetus slippage (bps) for USDY swaps when a caller doesn't specify one.
export const DEFAULT_USDY_SLIPPAGE_BPS = 100 // 1%

// All five protocols are valid in a vault (L/Y/S). stSUI is SUI-only, USDY is USDC-only.
export type YieldProtocol = 'navi' | 'scallop' | 'suilend' | 'usdy' | 'stsui'

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

// navi::pool_invest_navi<T>(pool, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id, amount)
// If the pool has no stored Navi AccountCap yet, mint one (lending::create_account) and
// store it into the pool DOF in the SAME tx before investing.
export function investNaviTx(
  poolId: string,
  amountRaw: bigint,
  opts: { needsCap: boolean },
  token: TokenConfig = TOKENS.USDC,
): Transaction {
  const tx = new Transaction()
  if (opts.needsCap) {
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
  return tx
}

// scallop::pool_invest_scallop<T>(pool, version, market, registry, clock, amount)
export function investScallopTx(poolId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
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

// ----- on-chain pool reads -----

export interface PoolSummary {
  idleRaw: bigint            // pool.balance — liquid token not yet invested/claimed
  totalDepositedRaw: bigint  // cumulative funded (net of deposit fee)
  totalClaimedRaw: bigint    // cumulative claimed by employees
  weeklyCommittedRaw: bigint // Σ weekly stream rate (the coverage floor at 1 week)
}

const toBig = (v: unknown): bigint => {
  try { return BigInt((v as string | number) ?? 0) } catch { return 0n }
}

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
  coverSuilend?: boolean
  // No USDY cover: a USDY position can't auto-convert to the base token on-chain.
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
  if (opts.coverSuilend) {
    tx.moveCall({
      target: `${ADAPTERS}::suilend::cover_claim_from_suilend`,
      typeArguments: [token.coinType],
      arguments: [
        tx.object(poolId),
        tx.object(SUILEND_LENDING_MARKET),
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
// Append a single vault invest leg (`amountRaw` of an already-funded bucket) for any
// protocol onto `tx`. Async only because USDY swaps through Cetus.
async function appendVaultInvest(
  tx: Transaction,
  vault: ReturnType<Transaction['object']>,
  protocol: YieldProtocol,
  token: TokenConfig,
  amountRaw: bigint,
  opts: { needsNaviCap: boolean; slippageBps: number },
): Promise<void> {
  const bucket = tx.pure.string(token.bucketName)
  if (protocol === 'navi') {
    if (opts.needsNaviCap) {
      const cap = tx.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
      tx.moveCall({ target: `${ADAPTERS}::navi::store_vault_account_cap`, arguments: [vault, cap] }) // NON-generic
    }
    tx.moveCall({
      target: `${ADAPTERS}::navi::vault_invest_navi`,
      typeArguments: [token.coinType],
      arguments: [
        vault, bucket,
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
  } else if (protocol === 'scallop') {
    tx.moveCall({
      target: `${ADAPTERS}::scallop::vault_invest_scallop`,
      typeArguments: [token.coinType],
      arguments: [vault, bucket, tx.object(SCALLOP_VERSION), tx.object(SCALLOP_MARKET), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(amountRaw)],
    })
  } else if (protocol === 'suilend') {
    tx.moveCall({
      target: `${ADAPTERS}::suilend::vault_invest_suilend`,
      typeArguments: [token.coinType],
      arguments: [vault, bucket, tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(amountRaw)],
    })
  } else if (protocol === 'stsui') {
    tx.moveCall({
      target: `${ADAPTERS_STSUI}::stsui::vault_invest_stsui`, // NO typeArguments, SUI bucket
      arguments: [vault, tx.pure.string('SUI'), tx.object(STSUI_LST_INFO), tx.object(STSUI_SYSTEM_STATE), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountRaw)],
    })
  } else {
    const [usdcCoin, receipt] = tx.moveCall({
      target: `${ADAPTERS}::usdy::vault_invest_usdy_extract`,
      typeArguments: [token.coinType],
      arguments: [vault, bucket, tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountRaw)],
    })
    const usdyCoin = await appendCetusSwap(tx, { inputCoin: usdcCoin, fromType: token.coinType, toType: USDY_TYPE, amountIn: amountRaw, slippageBps: opts.slippageBps })
    tx.moveCall({
      target: `${ADAPTERS}::usdy::vault_invest_usdy_deposit`,
      typeArguments: [token.coinType, USDY_TYPE],
      arguments: [vault, bucket, tx.object(PROTOCOL_REGISTRY), usdyCoin, receipt],
    })
  }
}

export interface AllocPlan {
  poolId: string
  vaultId: string | null // required when bucketDepositRaw > 0
  wallet: string // recipient of the cash remainder
  token: TokenConfig
  covers: CoverOpts
  bucketDepositRaw: bigint // total routed into the vault bucket (idle + invested legs)
  naviInvestRaw: bigint // portion of the bucket pushed into Navi (0 = leave idle)
  scallopInvestRaw: bigint // portion pushed into Scallop
  suilendInvestRaw?: bigint // portion pushed into Suilend
  usdyInvestRaw?: bigint // portion pushed into USDY (USDC token only; routes via Cetus)
  stsuiInvestRaw?: bigint // portion staked into stSUI (SUI token only)
  needsBucket: boolean // init the token bucket first (vault has none yet)
  needsNaviCap: boolean // mint + store a Navi AccountCap first
  slippageBps?: number // Cetus slippage for the USDY leg
}

// Async because the USDY leg swaps via Cetus; resolves immediately when no USDY leg.
export async function claimAndAllocateTx(plan: AllocPlan): Promise<Transaction> {
  const { token } = plan
  const slippageBps = plan.slippageBps ?? DEFAULT_USDY_SLIPPAGE_BPS
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
    const legs: [YieldProtocol, bigint][] = [
      ['navi', plan.naviInvestRaw],
      ['scallop', plan.scallopInvestRaw],
      ['suilend', plan.suilendInvestRaw ?? 0n],
      ['usdy', plan.usdyInvestRaw ?? 0n],
      ['stsui', plan.stsuiInvestRaw ?? 0n],
    ]
    for (const [protocol, amt] of legs) {
      if (amt > 0n) await appendVaultInvest(tx, vault, protocol, token, amt, { needsNaviCap: plan.needsNaviCap, slippageBps })
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

// Invest idle bucket funds into Suilend (vault).
export function vaultInvestSuilendTx(vaultId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::suilend::vault_invest_suilend`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(SUILEND_LENDING_MARKET),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// suilend::vault_withdraw_suilend<T> — full position (no amount), Suilend → idle.
export function vaultWithdrawSuilendTx(vaultId: string, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::suilend::vault_withdraw_suilend`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(SUILEND_LENDING_MARKET),
      tx.object(PROTOCOL_CONFIG),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
    ],
  })
  return tx
}

// stSUI vault invest — SUI only, non-generic, separate package. Stakes SUI → stSUI.
export function vaultInvestStsuiTx(vaultId: string, amountRaw: bigint): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS_STSUI}::stsui::vault_invest_stsui`, // NO typeArguments
    arguments: [
      tx.object(vaultId),
      tx.pure.string('SUI'),
      tx.object(STSUI_LST_INFO),
      tx.object(STSUI_SYSTEM_STATE),
      tx.object(PROTOCOL_REGISTRY),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// stSUI vault withdraw — full position, unstakes stSUI → SUI back into idle.
export function vaultWithdrawStsuiTx(vaultId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS_STSUI}::stsui::vault_withdraw_stsui`, // NO typeArguments
    arguments: [
      tx.object(vaultId),
      tx.pure.string('SUI'),
      tx.object(STSUI_LST_INFO),
      tx.object(STSUI_SYSTEM_STATE),
      tx.object(PROTOCOL_CONFIG),
      tx.object(PROTOCOL_REGISTRY),
    ],
  })
  return tx
}

// USDY vault invest — async 2-step extract→Cetus swap→deposit (idle → USDY).
export async function vaultInvestUsdyTx(
  vaultId: string,
  amountRaw: bigint,
  token: TokenConfig = TOKENS.USDC,
  slippageBps: number = DEFAULT_USDY_SLIPPAGE_BPS,
): Promise<Transaction> {
  const tx = new Transaction()
  const [usdcCoin, receipt] = tx.moveCall({
    target: `${ADAPTERS}::usdy::vault_invest_usdy_extract`,
    typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountRaw)],
  })
  const usdyCoin = await appendCetusSwap(tx, { inputCoin: usdcCoin, fromType: token.coinType, toType: USDY_TYPE, amountIn: amountRaw, slippageBps })
  tx.moveCall({
    target: `${ADAPTERS}::usdy::vault_invest_usdy_deposit`,
    typeArguments: [token.coinType, USDY_TYPE],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.object(PROTOCOL_REGISTRY), usdyCoin, receipt],
  })
  return tx
}

// USDY vault withdraw — async; amountYRaw is the USDY (Y) amount to unwind → idle.
export async function vaultWithdrawUsdyTx(
  vaultId: string,
  amountYRaw: bigint,
  token: TokenConfig = TOKENS.USDC,
  slippageBps: number = DEFAULT_USDY_SLIPPAGE_BPS,
): Promise<Transaction> {
  const tx = new Transaction()
  const [usdyCoin, receipt] = tx.moveCall({
    target: `${ADAPTERS}::usdy::vault_withdraw_usdy_extract`,
    typeArguments: [token.coinType, USDY_TYPE],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountYRaw)],
  })
  const usdcCoin = await appendCetusSwap(tx, { inputCoin: usdyCoin, fromType: USDY_TYPE, toType: token.coinType, amountIn: amountYRaw, slippageBps })
  tx.moveCall({
    target: `${ADAPTERS}::usdy::vault_withdraw_usdy_deposit`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(PROTOCOL_CONFIG),
      tx.object(PROTOCOL_REGISTRY),
      usdcCoin,
      receipt,
    ],
  })
  return tx
}

// navi::vault_withdraw_navi<T> — Navi → idle bucket balance.
export function vaultWithdrawNaviTx(vaultId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::navi::vault_withdraw_navi`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
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
  return tx
}

// scallop::vault_withdraw_scallop<T> — Scallop → idle bucket balance.
export function vaultWithdrawScallopTx(vaultId: string, amountRaw: bigint, token: TokenConfig = TOKENS.USDC): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ADAPTERS}::scallop::vault_withdraw_scallop`,
    typeArguments: [token.coinType],
    arguments: [
      tx.object(vaultId),
      tx.pure.string(token.bucketName),
      tx.object(SCALLOP_VERSION),
      tx.object(SCALLOP_MARKET),
      tx.object(PROTOCOL_CONFIG),
      tx.object(PROTOCOL_REGISTRY),
      tx.object(CLOCK),
      tx.pure.u64(amountRaw),
    ],
  })
  return tx
}

// employee_vault::withdraw_from_bucket<T> — move idle bucket funds to the caller's wallet.
export function withdrawToWalletTx(
  vaultId: string,
  amountRaw: bigint,
  recipient: string,
  token: TokenConfig = TOKENS.USDC,
): Transaction {
  const tx = new Transaction()
  const [coin] = tx.moveCall({
    target: `${CORE}::employee_vault::withdraw_from_bucket`,
    typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.pure.u64(amountRaw)],
  })
  tx.transferObjects([coin], tx.pure.address(recipient))
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
  suilendRaw: bigint
  usdyRaw: bigint // base-token (T) principal tracked in the USDY position
  usdyHeldYRaw: bigint // the actual Coin<Y> (USDY) balance held — pass to withdraw
  stsuiRaw: bigint // SUI principal staked into stSUI (SUI bucket only)
  idleRaw: bigint // liquid tokens sitting in the bucket, not yet invested
}

// Best-effort read of a vault's bucket for this token: invested principal per
// protocol (Navi/Scallop/Suilend/Usdy/StsuiVaultPositionKey → deposited_value) plus
// the bucket's liquid balance. Returns zeros for anything missing.
export async function readVaultInvestments(
  client: SuiJsonRpcClient,
  vaultId: string,
  token: TokenConfig = TOKENS.USDC,
): Promise<VaultInvestments> {
  const out: VaultInvestments = { naviRaw: 0n, scallopRaw: 0n, suilendRaw: 0n, usdyRaw: 0n, usdyHeldYRaw: 0n, stsuiRaw: 0n, idleRaw: 0n }
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
      const t = field.name.type
      const isNavi = t.includes('NaviVaultPositionKey')
      const isScallop = t.includes('ScallopVaultPositionKey')
      const isSuilend = t.includes('SuilendVaultPositionKey')
      const isUsdy = t.includes('UsdyVaultPositionKey')
      const isStsui = t.includes('StsuiVaultPositionKey')
      // Custodied USDY Coin<Y> under UsdyVaultKey (DOF); its balance is `total_y`.
      const isUsdyHeld = t.includes('UsdyVaultKey')
      if (!isNavi && !isScallop && !isSuilend && !isUsdy && !isStsui && !isUsdyHeld) continue
      try {
        if (isUsdyHeld) {
          const coin = await client.getDynamicFieldObject({ parentId: bucketId, name: field.name })
          const cc = coin.data?.content
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          out.usdyHeldYRaw = cc && cc.dataType === 'moveObject' ? toBig((cc.fields as any)?.balance) : 0n
          continue
        }
        const o = await client.getObject({ id: field.objectId, options: { showContent: true } })
        const c = o.data?.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value: any = c && c.dataType === 'moveObject' ? (c.fields as any).value : undefined
        const raw = toBig(value?.fields?.deposited_value ?? value?.deposited_value)
        if (isNavi) out.naviRaw = raw
        else if (isScallop) out.scallopRaw = raw
        else if (isSuilend) out.suilendRaw = raw
        else if (isUsdy) out.usdyRaw = raw
        else out.stsuiRaw = raw
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
