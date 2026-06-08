import { z } from 'zod'

const PROTOCOLS = ['SCALLOP', 'NAVI', 'USDY', 'BUCKET', 'AUTO_MAX_YIELD'] as const
const YIELD_TYPES = ['L', 'Y', 'S'] as const

export const createVaultSchema = z.object({
  on_chain_vault_id: z.string().min(1),
  name: z.string().min(1).max(100),
})

const allocationEntrySchema = z.object({
  token: z.string().min(1),
  yield_type: z.enum(YIELD_TYPES),
  percentage: z.number().positive(),
  protocol: z.enum(PROTOCOLS),
})

export const updateAllocationSchema = z.array(allocationEntrySchema)
