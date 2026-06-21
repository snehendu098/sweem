import { z } from 'zod'

export const createInvoiceSchema = z.object({
  org_wallet: z.string().min(1),
  amount: z.number().positive(),
  token: z.string().min(1),
  description: z.string().min(1).max(500),
  due_date: z.string().optional(),
  attachment_key: z.string().optional(),
})

// Approve / reject are pure off-chain status changes (message-signed). PAID is
// NOT here — it's set by /pay after verifying an on-chain payment by tx hash.
export const updateInvoiceSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(500).optional(),
})

export const payInvoiceSchema = z.object({
  tx_hash: z.string().min(1),
})
