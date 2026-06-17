const NAVI_POOLS_URL     = 'https://open-api.naviprotocol.io/api/navi/pools'
const SCALLOP_MARKET_URL = 'https://sdk.api.scallop.io/api/market/migrate'

export type YieldQuote = { protocol: string; apy: number }

// Navi /api/navi/pools entry — symbol under token.symbol; supply APY (incl. incentives)
// under supplyIncentiveApyInfo.apy (string %, e.g. "6.034"). top-level supplyApy is null.
type NaviPool    = { token?: { symbol?: string }; symbol?: string; supplyIncentiveApyInfo?: { apy?: string }; supplyApy?: string | null }
type ScallopPool = { coinName: string; supplyApy: number }

export async function resolveMaxYield(token: string): Promise<YieldQuote> {
  const results = await Promise.allSettled([
    fetchNaviApy(token),
    fetchScallopApy(token),
  ])

  const quotes = results
    .filter((r): r is PromiseFulfilledResult<YieldQuote> => r.status === 'fulfilled')
    .map((r) => r.value)

  if (quotes.length === 0) throw new Error(`No APY data available for ${token}`)

  return quotes.reduce((best, q) => (q.apy > best.apy ? q : best))
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
