import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../db/client'
import { paymentGroupPools, lastYieldRoutes } from '../db/schema'
import { createSuiClient, getObjectFields } from '../lib/sui'
import type { AuthEnv } from '../types'

export async function createPool(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const [pool] = await db
    .insert(paymentGroupPools)
    .values({
      paymentGroupId: c.req.param('group_id')!,
      token: body.token,
      onChainPoolId: body.on_chain_pool_id,
    })
    .returning()

  return c.json(pool, 201)
}

export async function listPools(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const sui = createSuiClient(c.env.SUI_NETWORK)

  const pools = await db.query.paymentGroupPools.findMany({
    where: eq(paymentGroupPools.paymentGroupId, c.req.param('group_id')!),
  })

  const enriched = await Promise.all(
    pools.map(async (pool) => {
      const fields = await getObjectFields(sui, pool.onChainPoolId)
      return { ...pool, on_chain: fields }
    }),
  )

  return c.json(enriched)
}

export async function getYieldRoute(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const routes = await db.query.lastYieldRoutes.findMany({
    where: eq(lastYieldRoutes.paymentGroupPoolId, c.req.param('pool_id')!),
  })
  return c.json(routes)
}

export async function updateYieldRoute(c: Context<AuthEnv>) {
  const body: Array<{ protocol: string; yield_type: string; allocation_pct: number }> = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const poolId = c.req.param('pool_id')!

  await db.delete(lastYieldRoutes).where(eq(lastYieldRoutes.paymentGroupPoolId, poolId))
  const inserted = await db
    .insert(lastYieldRoutes)
    .values(body.map((r) => ({
      paymentGroupPoolId: poolId,
      protocol: r.protocol,
      yieldType: r.yield_type,
      allocationPct: String(r.allocation_pct),
    })))
    .returning()

  return c.json(inserted)
}
