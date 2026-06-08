import { z } from 'zod'

export const sliceQuerySchema = z.object({
  token: z.string().min(1),
  rate_amount: z.coerce.number().positive(),
  rate_type: z.enum(['MONTHLY', 'HOURLY']),
})

export const runwayQuerySchema = z.object({
  pool_id: z.string().min(1),
})

export const maxYieldQuerySchema = z.object({
  token: z.string().min(1),
})
