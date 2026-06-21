import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { createDb } from '../db/client'
import { invoices, employees } from '../db/schema'
import type { AuthEnv, EmployeeEnv, AppEnv } from '../types'
import { validateAttachment, attachmentKey } from '../lib/attachment'
import { createSuiClient } from '../lib/sui'
import { verifyInvoicePayment } from '../lib/payment'

export async function listOrgInvoices(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!
  const status = c.req.query('status')

  const list = await db.query.invoices.findMany({
    where: status
      ? and(eq(invoices.orgWallet, orgWallet), eq(invoices.status, status))
      : eq(invoices.orgWallet, orgWallet),
    with: { employee: true },
    orderBy: [desc(invoices.createdAt)],
  })

  return c.json(list)
}

export async function updateInvoice(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!
  const invoiceId = c.req.param('id')!
  const body = await c.req.json()

  const existing = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.orgWallet, orgWallet)),
  })
  if (!existing) throw new HTTPException(404, { message: 'Invoice not found' })

  const [updated] = await db
    .update(invoices)
    .set({
      status: body.status,
      note: body.note ?? existing.note,
    })
    .where(eq(invoices.id, invoiceId))
    .returning()

  return c.json(updated)
}

// Mark an invoice PAID by VERIFYING an on-chain payment (no message signature):
// the org signs the actual coin-transfer tx, then submits its digest here. We
// confirm the tx succeeded and credited the employee the invoice amount.
export async function payInvoice(c: Context<AppEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!
  const invoiceId = c.req.param('id')!
  const { tx_hash } = await c.req.json()
  if (!tx_hash || typeof tx_hash !== 'string') {
    throw new HTTPException(400, { message: 'Missing tx_hash' })
  }

  const existing = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, invoiceId), eq(invoices.orgWallet, orgWallet)),
    with: { employee: true },
  })
  if (!existing) throw new HTTPException(404, { message: 'Invoice not found' })
  if (existing.status === 'PAID') return c.json(existing)
  if (!existing.employee) throw new HTTPException(404, { message: 'Employee not found' })

  const client = createSuiClient(c.env.SUI_NETWORK)
  const check = await verifyInvoicePayment(client, tx_hash, {
    sender: orgWallet,
    recipient: existing.employee.walletAddress,
    tokenSymbol: existing.token,
    amount: existing.amount,
  })
  if (!check.ok) throw new HTTPException(400, { message: check.error ?? 'Payment verification failed' })

  const [updated] = await db
    .update(invoices)
    .set({ status: 'PAID', txHash: tx_hash, paidAt: new Date() })
    .where(eq(invoices.id, invoiceId))
    .returning()

  return c.json(updated)
}

export async function listEmployeeOrgs(c: Context<EmployeeEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const walletAddress = c.req.query('wallet')
  if (!walletAddress) return c.json({ error: 'missing wallet' }, 400)

  const emps = await db.query.employees.findMany({
    where: eq(employees.walletAddress, walletAddress),
    with: { org: true },
  })

  return c.json(emps.map((e) => ({
    orgWallet: e.orgWallet,
    orgName: e.org?.name ?? '',
    employeeId: e.id,
    alias: e.alias,
  })))
}

export async function createEmployeeInvoice(c: Context<EmployeeEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const walletAddress = c.var.walletAddress
  const body = await c.req.json()

  const employee = await db.query.employees.findFirst({
    where: and(
      eq(employees.walletAddress, walletAddress),
      eq(employees.orgWallet, body.org_wallet),
    ),
  })
  if (!employee) throw new HTTPException(403, { message: 'Not an employee of this org' })

  const [invoice] = await db
    .insert(invoices)
    .values({
      orgWallet: body.org_wallet,
      employeeId: employee.id,
      amount: String(body.amount),
      token: body.token,
      description: body.description,
      dueDate: body.due_date ? new Date(body.due_date) : null,
      attachmentKey: body.attachment_key ?? null,
    })
    .returning()

  return c.json(invoice, 201)
}

export async function listEmployeeInvoices(c: Context<EmployeeEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const walletAddress = c.req.query('wallet')
  const orgWallet = c.req.query('orgWallet')
  if (!walletAddress) return c.json({ error: 'missing wallet' }, 400)

  const emps = await db.query.employees.findMany({
    where: orgWallet
      ? and(eq(employees.walletAddress, walletAddress), eq(employees.orgWallet, orgWallet))
      : eq(employees.walletAddress, walletAddress),
  })

  if (emps.length === 0) return c.json([])

  const ids = emps.map((e) => e.id)
  const list = await db.query.invoices.findMany({
    where: inArray(invoices.employeeId, ids),
    orderBy: [desc(invoices.createdAt)],
  })

  return c.json(list)
}

export async function uploadAttachment(c: Context<EmployeeEnv>) {
  const walletAddress = c.var.walletAddress
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) throw new HTTPException(400, { message: 'No file provided' })

  const validation = validateAttachment(file.name, file.size)
  if (!validation.ok) throw new HTTPException(400, { message: validation.error })

  const key = attachmentKey(walletAddress, crypto.randomUUID(), validation.ext)
  await c.env.ATTACHMENTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  })

  return c.json({ key })
}

export async function serveAttachment(c: Context<AppEnv>) {
  const wallet = c.req.param('wallet')
  const file = c.req.param('file')
  const fullKey = `${wallet}/${file}`
  const obj = await c.env.ATTACHMENTS.get(fullKey)
  if (!obj) throw new HTTPException(404, { message: 'Attachment not found' })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(obj.body, { headers })
}
