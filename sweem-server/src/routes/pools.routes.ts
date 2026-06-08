import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createPool, listPools, getYieldRoute, updateYieldRoute } from '../controllers/pools.controllers'
import { createPoolSchema, updateYieldRouteSchema } from '../schemas/pools.schema'

const pools = new Hono<AuthEnv>()

pools.post('/', authMiddleware, zValidator('json', createPoolSchema), createPool)
pools.get('/', listPools)
pools.get('/:pool_id/yield-route', getYieldRoute)
pools.put('/:pool_id/yield-route', authMiddleware, zValidator('json', updateYieldRouteSchema), updateYieldRoute)

export default pools
