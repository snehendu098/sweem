import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { listOrgInvoices, updateInvoice } from '../controllers/invoices.controllers'
import { updateInvoiceSchema } from '../schemas/invoices.schema'

const invoiceRoutes = new Hono<AuthEnv>()

invoiceRoutes.get('/', listOrgInvoices)
invoiceRoutes.put('/:id', authMiddleware, zValidator('json', updateInvoiceSchema), updateInvoice)

export default invoiceRoutes
