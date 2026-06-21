import { z } from 'zod'

export const createKeySchema = z.object({
  name: z.string().min(2).max(40),
  // Optional override; when omitted the org's own wallet receives payments.
  receiving_address: z.string().min(3).max(80).optional(),
})
