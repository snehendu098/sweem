import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { listOrgInvoices, updateInvoice, payInvoice } from '../controllers/invoices.controllers'
import { updateInvoiceSchema, payInvoiceSchema } from '../schemas/invoices.schema'

const invoiceRoutes = new Hono<AuthEnv>()

invoiceRoutes.get('/', listOrgInvoices)
invoiceRoutes.put('/:id', authMiddleware, zValidator('json', updateInvoiceSchema), updateInvoice)
// PAID is verified on-chain by tx hash — no message signature required.
invoiceRoutes.post('/:id/pay', zValidator('json', payInvoiceSchema), payInvoice)

export default invoiceRoutes
