import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../types'
import { getSlice, getRunway, getMaxYield } from '../controllers/compute.controllers'
import { sliceQuerySchema, runwayQuerySchema, maxYieldQuerySchema } from '../schemas/compute.schema'

const compute = new Hono<AppEnv>()

compute.get('/slice',     zValidator('query', sliceQuerySchema),    getSlice)
compute.get('/runway',    zValidator('query', runwayQuerySchema),   getRunway)
compute.get('/max-yield', zValidator('query', maxYieldQuerySchema), getMaxYield)

export default compute
