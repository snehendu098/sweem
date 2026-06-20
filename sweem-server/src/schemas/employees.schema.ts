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
  email: z.string().email().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  rates: z.array(rateSchema).optional(),
})

export const updateRatesSchema = z.array(rateSchema)

export const updateEmployeeSchema = z.object({
  group_id: z.string().uuid().nullable().optional(),
  rates: z.array(rateSchema).optional(),
})

// Bulk import (CSV onboarding). Each row may carry a group_name (resolved to /
// created as a group) instead of a group_id.
const bulkEmployeeSchema = z.object({
  alias: z.string().min(1).max(100),
  wallet_address: z.string().min(1),
  email: z.string().email().nullable().optional(),
  group_id: z.string().uuid().nullable().optional(),
  group_name: z.string().min(1).max(100).nullable().optional(),
  rates: z.array(rateSchema).optional(),
})

export const bulkCreateEmployeesSchema = z.object({
  employees: z.array(bulkEmployeeSchema).min(1).max(1000),
})
