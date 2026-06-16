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

export const CLOCK = '0x6'

export const WEEK_MS = 604_800_000
export const MONTH_MS = 2_592_000_000 // 30 days — the stream rate period we use

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export const EXPLORER_TX = (digest: string) => `https://suiscan.xyz/mainnet/tx/${digest}`
export const EXPLORER_OBJ = (id: string) => `https://suiscan.xyz/mainnet/object/${id}`

// ----- amount helpers (USDC <-> raw 6dp) -----
export function toRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10 ** USDC_DECIMALS))
}
export function fromRaw(raw: bigint | string | number): number {
  return Number(BigInt(raw)) / 10 ** USDC_DECIMALS
}

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
