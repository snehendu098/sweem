import { z } from 'zod'

export const createInvoiceSchema = z.object({
  org_wallet: z.string().min(1),
  amount: z.number().positive(),
  token: z.string().min(1),
  description: z.string().min(1).max(500),
  due_date: z.string().optional(),
  attachment_key: z.string().optional(),
})

export const updateInvoiceSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'PAID']),
  note: z.string().max(500).optional(),
})
