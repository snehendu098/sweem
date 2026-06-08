import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { paymentGroupPools, employees } from '../db/schema'
import { createSuiClient, getObjectFields } from '../lib/sui'
import { computeSlicePerMs } from '../lib/slice'
import { resolveMaxYield } from '../lib/yield'
import type { AppEnv } from '../types'

export async function getSlice(c: Context<AppEnv>) {
  const { token, rate_amount, rate_type } = c.req.query() as Record<string, string>
  const slicePerMs = computeSlicePerMs(Number(rate_amount), rate_type as 'MONTHLY' | 'HOURLY')
  return c.json({ token, rate_amount: Number(rate_amount), rate_type, slice_per_ms: slicePerMs })
}

export async function getRunway(c: Context<AppEnv>) {
  const poolId = c.req.query('pool_id')
  if (!poolId) throw new HTTPException(400, { message: 'pool_id required' })

  const db = createDb(c.env.DB.connectionString)
  const sui = createSuiClient(c.env.SUI_NETWORK)

  const pool = await db.query.paymentGroupPools.findFirst({
    where: eq(paymentGroupPools.onChainPoolId, poolId),
  })
  if (!pool) throw new HTTPException(404, { message: 'Pool not found' })

  const fields = await getObjectFields(sui, poolId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balance = Number((fields as any)?.balance ?? 0)

  const groupEmployees = await db.query.employees.findMany({
    where: eq(employees.paymentGroupId, pool.paymentGroupId),
    with: { rates: true },
  })

  let activeSliceTotal = 0
  for (const emp of groupEmployees) {
    for (const rate of emp.rates) {
      if (rate.token === pool.token && rate.rateAmount && rate.rateType) {
        activeSliceTotal += computeSlicePerMs(Number(rate.rateAmount), rate.rateType as 'MONTHLY' | 'HOURLY')
      }
    }
  }

  const runwayMs = activeSliceTotal > 0 ? Math.floor(balance / activeSliceTotal) : Infinity
  const runwayDays = isFinite(runwayMs) ? runwayMs / (24 * 60 * 60 * 1_000) : null

  return c.json({
    pool_id: poolId,
    token: pool.token,
    balance,
    active_slice_total: activeSliceTotal,
    runway_ms: isFinite(runwayMs) ? runwayMs : null,
    runway_days: runwayDays,
  })
}

export async function getMaxYield(c: Context<AppEnv>) {
  const token = c.req.query('token')
  if (!token) throw new HTTPException(400, { message: 'token required' })

  const result = await resolveMaxYield(token)
  return c.json({ token, ...result })
}
