// Sweem mainnet constants + helpers. Package/object IDs come from the live
// deployment (see scripts/deployed.json). These are stable shared objects.

export const NETWORK = 'mainnet' as const

// Published packages
export const CORE = '0x4c582aea3efe99fb68deea8b71b96eda6fba06001ed5588da83799c09f9179b4'
export const ADAPTERS = '0x8f0943975ec6f56f97e197713041b192e8ff9b4461c0a496bf129ed37b2866eb'

// Shared registry objects
export const PROTOCOL_CONFIG = '0x303eb1778420425b1b590452bdaf039e4c6d46431bd502fdad028a305d3d04f1'
export const PROTOCOL_REGISTRY = '0xde3026a8847dc89b9b8ce456bf1e316dc60366e8564ac07bc55b50229e146dd8'

// Native mainnet USDC (6 decimals)
export const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export const USDC_DECIMALS = 6

// Native SUI (9 decimals). Full normalized type so event MoveEventType filters match.
export const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
export const SUI_DECIMALS = 9

export const CLOCK = '0x6'

// ----- Navi (mainnet, verified) -----
export const NAVI_LENDING_CORE_PKG = '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb'
export const NAVI_STORAGE = '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'
export const NAVI_PRICE_ORACLE = '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef'
export const NAVI_INCENTIVE_V2 = '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'
export const NAVI_INCENTIVE_V3 = '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
export const NAVI_POOL_USDC = '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8'
export const NAVI_ASSET_ID_USDC = 10
export const NAVI_POOL_SUI = '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5'
export const NAVI_ASSET_ID_SUI = 0

// ----- Scallop (mainnet, verified). Version + Market are global singletons,
// shared across every coin type — no per-token objects needed. -----
export const SCALLOP_VERSION = '0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7'
export const SCALLOP_MARKET = '0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9'

// Per-leg Navi supply minimums (human units), tied to each pool's protocol min.
export const NAVI_MIN_INVEST_USDC = 5
export const NAVI_MIN_INVEST_SUI = 0.0055

export const WEEK_MS = 604_800_000
export const MONTH_MS = 2_592_000_000 // 30 days — the stream rate period we use

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || 'https://sweem-server-mainnet.silonelabs.workers.dev'

export const EXPLORER_TX = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`
export const EXPLORER_OBJ = (id: string) => `https://suiscan.xyz/mainnet/object/${id}`

// Amount <-> base-unit conversion is token-aware; see lib/tokens.ts (toRaw/fromRaw).

// Minimum claimable (raw) before stream_pool::claim will accept a claim:
// 10% of one week's earnings at the stream rate. Rate-independent in time
// (~16.8h of accrual) but expressed here as a raw-amount threshold.
export function minClaimRaw(rateRaw: bigint, periodMs: bigint): bigint {
  if (periodMs === 0n) return 0n
  return (BigInt(WEEK_MS) * rateRaw) / (periodMs * 10n)
}

// On-chain weekly commitment per stream (ceil), used to size the coverage floor:
// ceil(rate * WEEK_MS / period).
export function weeklyCommitRaw(rateRaw: bigint, periodMs: bigint): bigint {
  if (periodMs === 0n) return 0n
  const num = rateRaw * BigInt(WEEK_MS)
  return (num + periodMs - 1n) / periodMs
}
