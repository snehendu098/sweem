export const MS_PER_MONTH = BigInt(30 * 24 * 60 * 60 * 1_000)  // 2_592_000_000
export const MS_PER_HOUR  = BigInt(3_600 * 1_000)               // 3_600_000

export type RateParams = {
  rateAmount: bigint
  ratePeriodMs: bigint
}

export function computeRateParams(rateAmountBaseUnits: bigint, rateType: 'MONTHLY' | 'HOURLY'): RateParams {
  return {
    rateAmount: rateAmountBaseUnits,
    ratePeriodMs: rateType === 'MONTHLY' ? MS_PER_MONTH : MS_PER_HOUR,
  }
}

export function computeRateParamsFromPercentage(
  percentage: number,
  groupTotalRateAmount: bigint,
  groupRatePeriodMs: bigint,
): RateParams {
  return {
    rateAmount: BigInt(percentage) * groupTotalRateAmount / 100n,
    ratePeriodMs: groupRatePeriodMs,
  }
}

export function computeClaimable(
  elapsedMs: bigint,
  rateAmount: bigint,
  ratePeriodMs: bigint,
): bigint {
  if (elapsedMs <= 0n || rateAmount <= 0n || ratePeriodMs <= 0n) return 0n
  return elapsedMs * rateAmount / ratePeriodMs
}

// Streamed amount per millisecond as a float — used for display (slice endpoint)
// and runway estimation (balance / slicePerMs ≈ ms remaining). For EXACT accrued
// amounts use computeClaimable, which multiplies before dividing to avoid the
// integer precision loss that a floored per-ms slice would introduce.
export function computeSlicePerMs(
  rateAmount: number,
  rateType: 'MONTHLY' | 'HOURLY',
): number {
  const periodMs = rateType === 'MONTHLY' ? Number(MS_PER_MONTH) : Number(MS_PER_HOUR)
  if (periodMs <= 0 || !(rateAmount > 0)) return 0
  return rateAmount / periodMs
}
