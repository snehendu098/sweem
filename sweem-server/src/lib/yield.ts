import type { SuiClient } from './sui'

const NAVI_POOLS_URL     = 'https://open-api.naviprotocol.io/api/navi/pools'
const SCALLOP_MARKET_URL = 'https://sdk.api.scallop.io/api/market/migrate'
const DEFILLAMA_POOLS_URL = 'https://yields.llama.fi/pools'

// Suilend main lending market (mainnet) — holds every reserve.
const SUILEND_LENDING_MARKET = '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1'

export type YieldQuote = { protocol: string; apy: number }

// Navi /api/navi/pools entry — symbol under token.symbol; supply APY (incl. incentives)
// under supplyIncentiveApyInfo.apy (string %, e.g. "6.034"). top-level supplyApy is null.
type NaviPool    = { token?: { symbol?: string }; symbol?: string; supplyIncentiveApyInfo?: { apy?: string }; supplyApy?: string | null }
type ScallopPool = { coinName: string; supplyApy: number }

// Full Move coin type per token symbol — used to match Suilend reserves (and to
// disambiguate native USDC from wormhole USDC).
const COIN_TYPE: Record<string, string> = {
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  SUI: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
}

// Normalize a coin type for comparison: strip leading 0x and left-pad the address.
function normCoinType(t: string): string {
  const s = t.startsWith('0x') ? t.slice(2) : t
  const [addr, ...rest] = s.split('::')
  if (rest.length === 0) return s.toLowerCase()
  return `${addr.padStart(64, '0')}::${rest.join('::')}`.toLowerCase()
}

// resolveMaxYield needs every protocol that supports `token`. The Sui client is
// optional so plain HTTP-only callers still work; on-chain fetchers are skipped
// without it.
export async function resolveMaxYield(token: string, client?: SuiClient): Promise<YieldQuote> {
  const quotes = await collectYields(token, client)
  if (quotes.length === 0) throw new Error(`No APY data available for ${token}`)
  return quotes.reduce((best, q) => (q.apy > best.apy ? q : best))
}

// Live quotes across every protocol that supports `token`. Each source is
// best-effort: a failed fetch is omitted (never a hardcoded number).
export async function collectYields(token: string, client?: SuiClient): Promise<YieldQuote[]> {
  const sym = token.toUpperCase()
  const jobs: Promise<YieldQuote>[] = [fetchNaviApy(token), fetchScallopApy(token)]
  if (client) jobs.push(fetchSuilendApy(token, client))
  if (sym === 'USDC') jobs.push(fetchUsdyApy())
  if (sym === 'SUI' && client) jobs.push(fetchStsuiApy(client))

  const settled = await Promise.allSettled(jobs)
  return settled
    .filter((r): r is PromiseFulfilledResult<YieldQuote> => r.status === 'fulfilled')
    .map((r) => r.value)
}

export async function fetchNaviApy(token: string): Promise<YieldQuote> {
  const res = await fetch(NAVI_POOLS_URL)
  if (!res.ok) throw new Error(`Navi API ${res.status}`)

  const json = (await res.json()) as NaviPool[] | { data?: NaviPool[] }
  const pools: NaviPool[] = Array.isArray(json) ? json : (json.data ?? [])
  const pool = pools.find(
    (p) => (p.token?.symbol ?? p.symbol ?? '').toUpperCase() === token.toUpperCase(),
  )
  if (!pool) throw new Error(`Navi: no pool for ${token}`)

  // Supply APY (incl. incentives) is a string percentage e.g. "6.034".
  const apy = parseFloat(pool.supplyIncentiveApyInfo?.apy ?? pool.supplyApy ?? '0')
  return { protocol: 'NAVI', apy }
}

export async function fetchScallopApy(token: string): Promise<YieldQuote> {
  const res = await fetch(SCALLOP_MARKET_URL)
  if (!res.ok) throw new Error(`Scallop API ${res.status}`)

  const data: { pools: ScallopPool[] } = await res.json()
  const pool = data.pools.find((p) => p.coinName.toLowerCase() === token.toLowerCase())
  if (!pool) throw new Error(`Scallop: no pool for ${token}`)

  // Scallop returns supplyApy as a decimal e.g. 0.054 = 5.4%
  return { protocol: 'SCALLOP', apy: pool.supplyApy * 100 }
}

// Suilend supply APR computed live from the on-chain reserve interest-rate model:
//   utilization   = borrowed / (borrowed + available)
//   borrowApr     = piecewise-linear interpolation of interest_rate_aprs over utils
//   supplyApr     = borrowApr × utilization × (1 − spreadFee)
// available_amount is a u64 (mint decimals); borrowed_amount is a Decimal (×1e18).
export async function fetchSuilendApy(token: string, client: SuiClient): Promise<YieldQuote> {
  const want = COIN_TYPE[token.toUpperCase()]
  if (!want) throw new Error(`Suilend: unsupported token ${token}`)

  const obj = await client.getObject({ id: SUILEND_LENDING_MARKET, options: { showContent: true } })
  const content = obj.data?.content
  if (!content || content.dataType !== 'moveObject') throw new Error('Suilend: market not readable')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reserves: any[] = (content.fields as any)?.reserves ?? []

  const target = normCoinType(want)
  const reserve = reserves.find((r) => {
    const name: string = r?.fields?.coin_type?.fields?.name ?? ''
    return normCoinType(name) === target
  })
  if (!reserve) throw new Error(`Suilend: no reserve for ${token}`)

  const f = reserve.fields
  const available = Number(f.available_amount)
  const borrowed = Number(f.borrowed_amount?.fields?.value ?? 0) / 1e18
  const denom = available + borrowed
  const util = denom > 0 ? borrowed / denom : 0 // 0..1

  const cfg = f.config?.fields?.element?.fields ?? f.config?.fields
  const utils: number[] = (cfg?.interest_rate_utils ?? []).map(Number) // percent points
  const aprs: number[] = (cfg?.interest_rate_aprs ?? []).map(Number) // basis points
  const spreadFee = Number(cfg?.spread_fee_bps ?? 0) / 10_000
  if (utils.length < 2 || utils.length !== aprs.length) throw new Error('Suilend: bad rate curve')

  const borrowApr = interpolate(util * 100, utils, aprs) / 100 // bps → percent
  const supplyApr = borrowApr * util * (1 - spreadFee)
  return { protocol: 'SUILEND', apy: supplyApr }
}

// Piecewise-linear interpolation: y at `x` over ascending xs[] / ys[].
function interpolate(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0]
  const last = xs.length - 1
  if (x >= xs[last]) return ys[last]
  for (let i = 1; i <= last; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
      return ys[i - 1] + t * (ys[i] - ys[i - 1])
    }
  }
  return ys[last]
}

// stSUI tracks native SUI staking yield. Average the live validator APYs.
export async function fetchStsuiApy(client: SuiClient): Promise<YieldQuote> {
  const res = await client.getValidatorsApy()
  const apys = res?.apys ?? []
  if (apys.length === 0) throw new Error('stSUI: no validator APYs')
  const avg = apys.reduce((s, a) => s + Number(a.apy), 0) / apys.length
  return { protocol: 'STSUI', apy: avg * 100 } // suix returns a 0..1 fraction
}

// Ondo USDY yield from DefiLlama's public pools feed (no auth).
export async function fetchUsdyApy(): Promise<YieldQuote> {
  const res = await fetch(DEFILLAMA_POOLS_URL)
  if (!res.ok) throw new Error(`DefiLlama ${res.status}`)
  const json = (await res.json()) as { data?: { project?: string; symbol?: string; chain?: string; apy?: number }[] }
  const pool = (json.data ?? []).find(
    (p) => p.project === 'ondo-yield-assets' && (p.symbol ?? '').toUpperCase() === 'USDY',
  )
  if (!pool || pool.apy == null) throw new Error('USDY: no DefiLlama pool')
  return { protocol: 'USDY', apy: pool.apy }
}
