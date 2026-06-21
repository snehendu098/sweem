import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { EmployeeEnv } from '../types'
import { employeeAuthMiddleware } from '../middleware/employee-auth.middleware'
import {
  listEmployeeOrgs,
  createEmployeeInvoice,
  listEmployeeInvoices,
  uploadAttachment,
} from '../controllers/invoices.controllers'
import { createInvoiceSchema } from '../schemas/invoices.schema'

const employeeRoutes = new Hono<EmployeeEnv>()

employeeRoutes.get('/orgs', listEmployeeOrgs)
employeeRoutes.get('/invoices', listEmployeeInvoices)
employeeRoutes.post('/invoices', employeeAuthMiddleware, zValidator('json', createInvoiceSchema), createEmployeeInvoice)
employeeRoutes.post('/upload', employeeAuthMiddleware, uploadAttachment)

export default employeeRoutes
