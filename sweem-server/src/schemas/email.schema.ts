import { z } from 'zod'

export const startEmailSchema = z.object({
  email: z.string().email(),
})

export const confirmEmailSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
})
