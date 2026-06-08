import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveMaxYield, fetchNaviApy, fetchScallopApy } from './yield'

const naviPool = (symbol: string, supplyApy: string) => ({ symbol, supplyApy })
const scallopPool = (coinName: string, supplyApy: number) => ({ coinName, supplyApy })

function mockFetch(naviPools: object[], scallopPools: object[]) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('naviprotocol')) {
      return { ok: true, json: async () => naviPools } as Response
    }
    if (url.includes('scallop')) {
      return { ok: true, json: async () => ({ pools: scallopPools }) } as Response
    }
    throw new Error(`Unexpected URL: ${url}`)
  })
}

beforeEach(() => vi.unstubAllGlobals())

describe('fetchNaviApy', () => {
  it('returns apy as number for matched token', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [naviPool('USDC', '5.334'), naviPool('SUI', '2.712')],
    } as Response))

    const result = await fetchNaviApy('USDC')
    expect(result).toEqual({ protocol: 'NAVI', apy: 5.334 })
  })

  it('is case-insensitive on token symbol', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [naviPool('USDC', '5.334')],
    } as Response))

    const result = await fetchNaviApy('usdc')
    expect(result.apy).toBe(5.334)
  })

  it('throws when token not in pool list', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => [naviPool('SUI', '2.712')],
    } as Response))

    await expect(fetchNaviApy('USDC')).rejects.toThrow('Navi: no pool for USDC')
  })

  it('throws on non-200 response', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 } as Response))

    await expect(fetchNaviApy('USDC')).rejects.toThrow('Navi API 503')
  })
})

describe('fetchScallopApy', () => {
  it('converts decimal apy to percentage', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ pools: [scallopPool('usdc', 0.0549797)] }),
    } as Response))

    const result = await fetchScallopApy('USDC')
    expect(result.protocol).toBe('SCALLOP')
    expect(result.apy).toBeCloseTo(5.49797, 4)
  })

  it('matches coinName case-insensitively', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ pools: [scallopPool('usdc', 0.08)] }),
    } as Response))

    const result = await fetchScallopApy('USDC')
    expect(result.apy).toBeCloseTo(8.0, 5)
  })

  it('throws when token not in pool list', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ pools: [scallopPool('sui', 0.03)] }),
    } as Response))

    await expect(fetchScallopApy('USDC')).rejects.toThrow('Scallop: no pool for USDC')
  })

  it('throws on non-200 response', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429 } as Response))

    await expect(fetchScallopApy('USDC')).rejects.toThrow('Scallop API 429')
  })
})

describe('resolveMaxYield', () => {
  it('picks the protocol with higher apy', async () => {
    mockFetch(
      [naviPool('USDC', '5.334')],
      [scallopPool('usdc', 0.082)],  // 8.2% > 5.334%
    )

    const result = await resolveMaxYield('USDC')
    expect(result.protocol).toBe('SCALLOP')
    expect(result.apy).toBeCloseTo(8.2, 4)
  })

  it('picks navi when it has higher apy', async () => {
    mockFetch(
      [naviPool('USDC', '10.5')],
      [scallopPool('usdc', 0.06)],   // 6% < 10.5%
    )

    const result = await resolveMaxYield('USDC')
    expect(result.protocol).toBe('NAVI')
    expect(result.apy).toBe(10.5)
  })

  it('falls back to one protocol if the other fails', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('naviprotocol')) return { ok: false, status: 500 } as Response
      return { ok: true, json: async () => ({ pools: [scallopPool('usdc', 0.07)] }) } as Response
    })

    const result = await resolveMaxYield('USDC')
    expect(result.protocol).toBe('SCALLOP')
    expect(result.apy).toBeCloseTo(7.0, 5)
  })

  it('throws when both protocols fail', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 } as Response))

    await expect(resolveMaxYield('USDC')).rejects.toThrow('No APY data available for USDC')
  })

  it('throws when token missing from both protocols', async () => {
    mockFetch([naviPool('SUI', '2.0')], [scallopPool('sui', 0.02)])

    await expect(resolveMaxYield('USDC')).rejects.toThrow('No APY data available for USDC')
  })
})
