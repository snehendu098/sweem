const NAVI_POOLS_URL     = 'https://open-api.naviprotocol.io/api/pool'
const SCALLOP_MARKET_URL = 'https://sdk.api.scallop.io/api/market/migrate'

export type YieldQuote = { protocol: string; apy: number }

type NaviPool    = { symbol: string; supplyApy: string }
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

  const pools: NaviPool[] = await res.json()
  const pool = pools.find((p) => p.symbol.toUpperCase() === token.toUpperCase())
  if (!pool) throw new Error(`Navi: no pool for ${token}`)

  // Navi returns supplyApy as a string percentage e.g. "5.334"
  return { protocol: 'NAVI', apy: parseFloat(pool.supplyApy) }
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
