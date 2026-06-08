import { z } from 'zod'

export const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  logo_url: z.string().url().optional(),
})

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logo_url: z.string().url().optional(),
})
