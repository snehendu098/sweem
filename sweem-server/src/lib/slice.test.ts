import { describe, it, expect } from 'vitest'
import {
  computeRateParams,
  computeRateParamsFromPercentage,
  computeClaimable,
  MS_PER_MONTH,
  MS_PER_HOUR,
} from './slice'

// Token decimal helpers
const USDC  = (amount: number) => BigInt(amount) * 1_000_000n          // 6 decimals
const USDT  = (amount: number) => BigInt(amount) * 1_000_000n          // 6 decimals
const SUI   = (amount: number) => BigInt(amount) * 1_000_000_000n      // 9 decimals

const DAY_MS   = 86_400_000n
const WEEK_MS  = 604_800_000n
const MONTH_MS = 2_592_000_000n

describe('computeRateParams — MONTHLY', () => {
  it('USDC: 100/month returns correct rate params', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    expect(rateAmount).toBe(100_000_000n)
    expect(ratePeriodMs).toBe(MS_PER_MONTH)
  })

  it('SUI: 100/month returns correct rate params', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(SUI(100), 'MONTHLY')
    expect(rateAmount).toBe(100_000_000_000n)
    expect(ratePeriodMs).toBe(MS_PER_MONTH)
  })

  it('USDT: 500/month returns correct rate params', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDT(500), 'MONTHLY')
    expect(rateAmount).toBe(500_000_000n)
    expect(ratePeriodMs).toBe(MS_PER_MONTH)
  })
})

describe('computeRateParams — HOURLY', () => {
  it('USDC: 10/hour returns correct rate params', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(10), 'HOURLY')
    expect(rateAmount).toBe(10_000_000n)
    expect(ratePeriodMs).toBe(MS_PER_HOUR)
  })
})

describe('computeClaimable — USDC (6 decimals)', () => {
  it('100 USDC/month — after 10 days earns ~33.33 USDC', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    const claimable = computeClaimable(DAY_MS * 10n, rateAmount, ratePeriodMs)
    // 864_000_000 * 100_000_000 / 2_592_000_000 = 33_333_333
    expect(claimable).toBe(33_333_333n)
  })

  it('100 USDC/month — after full month earns exactly 100 USDC', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    const claimable = computeClaimable(MONTH_MS, rateAmount, ratePeriodMs)
    expect(claimable).toBe(USDC(100))
  })

  it('100 USDC/month — after 1 day earns non-zero (precision fix)', () => {
    // Old slice_per_ms = floor(100_000_000 / 2_592_000_000) = 0 → would earn nothing
    // New approach: 86_400_000 * 100_000_000 / 2_592_000_000 = 3_333_333
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    const claimable = computeClaimable(DAY_MS, rateAmount, ratePeriodMs)
    expect(claimable).toBe(3_333_333n)
    expect(claimable).toBeGreaterThan(0n)
  })

  it('1000 USDC/month — 10 employees each 100 USDC — correct total', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    const totalClaimable = 10n * computeClaimable(MONTH_MS, rateAmount, ratePeriodMs)
    expect(totalClaimable).toBe(USDC(1000))
  })
})

describe('computeClaimable — USDT (6 decimals)', () => {
  it('500 USDT/month — after 1 week earns ~116.67 USDT', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDT(500), 'MONTHLY')
    const claimable = computeClaimable(WEEK_MS, rateAmount, ratePeriodMs)
    // 604_800_000 * 500_000_000 / 2_592_000_000 = 116_666_666
    expect(claimable).toBe(116_666_666n)
  })

  it('500 USDT/month — after full month earns exactly 500 USDT', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDT(500), 'MONTHLY')
    expect(computeClaimable(MONTH_MS, rateAmount, ratePeriodMs)).toBe(USDT(500))
  })
})

describe('computeClaimable — SUI (9 decimals)', () => {
  it('100 SUI/month — after 10 days earns ~33.33 SUI', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(SUI(100), 'MONTHLY')
    const claimable = computeClaimable(DAY_MS * 10n, rateAmount, ratePeriodMs)
    // 864_000_000 * 100_000_000_000 / 2_592_000_000 = 33_333_333_333
    expect(claimable).toBe(33_333_333_333n)
  })

  it('100 SUI/month — after full month earns exactly 100 SUI', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(SUI(100), 'MONTHLY')
    expect(computeClaimable(MONTH_MS, rateAmount, ratePeriodMs)).toBe(SUI(100))
  })

  it('100 SUI/month — after 1 day earns non-zero (precision fix)', () => {
    // Old: floor(100_000_000_000 / 2_592_000_000) = 38 slice/ms
    // New: 86_400_000 * 100_000_000_000 / 2_592_000_000 = 3_333_333_333
    const { rateAmount, ratePeriodMs } = computeRateParams(SUI(100), 'MONTHLY')
    const claimable = computeClaimable(DAY_MS, rateAmount, ratePeriodMs)
    expect(claimable).toBe(3_333_333_333n)
  })

  it('10 SUI/hour — after 30 minutes earns 5 SUI', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(SUI(10), 'HOURLY')
    const thirtyMins = 1_800_000n
    const claimable = computeClaimable(thirtyMins, rateAmount, ratePeriodMs)
    expect(claimable).toBe(SUI(5))
  })
})

describe('computeRateParamsFromPercentage', () => {
  it('30% of 1000 USDC/month total → 300 USDC effective rate', () => {
    const groupTotal = USDC(1000)
    const { rateAmount, ratePeriodMs } = computeRateParamsFromPercentage(30, groupTotal, MS_PER_MONTH)
    const claimable = computeClaimable(MONTH_MS, rateAmount, ratePeriodMs)
    expect(claimable).toBe(USDC(300))
  })

  it('inherits group rate period', () => {
    const { ratePeriodMs } = computeRateParamsFromPercentage(50, USDC(100), MS_PER_HOUR)
    expect(ratePeriodMs).toBe(MS_PER_HOUR)
  })
})

describe('computeClaimable — edge cases', () => {
  it('returns 0 for zero elapsed time', () => {
    const { rateAmount, ratePeriodMs } = computeRateParams(USDC(100), 'MONTHLY')
    expect(computeClaimable(0n, rateAmount, ratePeriodMs)).toBe(0n)
  })

  it('returns 0 for zero rate amount', () => {
    expect(computeClaimable(MONTH_MS, 0n, MS_PER_MONTH)).toBe(0n)
  })
})
