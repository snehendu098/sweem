import { z } from 'zod'

const PROTOCOLS = ['SCALLOP', 'NAVI', 'USDY', 'BUCKET'] as const
const YIELD_TYPES = ['L', 'Y', 'S'] as const

export const createPoolSchema = z.object({
  token: z.string().min(1),
  on_chain_pool_id: z.string().min(1),
})

const yieldRouteEntrySchema = z.object({
  protocol: z.enum(PROTOCOLS),
  yield_type: z.enum(YIELD_TYPES),
  allocation_pct: z.number().positive(),
})

export const updateYieldRouteSchema = z.array(yieldRouteEntrySchema).refine(
  (items) => items.reduce((sum, i) => sum + i.allocation_pct, 0) === 100,
  { message: 'allocation_pct must sum to 100' },
)
