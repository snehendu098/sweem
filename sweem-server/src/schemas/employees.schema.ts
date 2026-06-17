import { z } from 'zod'

const rateSchema = z.union([
  z.object({
    token: z.string().min(1),
    rate_amount: z.number().positive(),
    rate_type: z.enum(['MONTHLY', 'HOURLY']),
  }),
  z.object({
    token: z.string().min(1),
    percentage: z.number().positive().max(100),
  }),
])

export const createEmployeeSchema = z.object({
  alias: z.string().min(1).max(100),
  wallet_address: z.string().min(1),
  group_id: z.string().uuid().nullable().optional(),
  rates: z.array(rateSchema).optional(),
})

export const updateRatesSchema = z.array(rateSchema)

export const updateEmployeeSchema = z.object({
  group_id: z.string().uuid().nullable().optional(),
  rates: z.array(rateSchema).optional(),
})
