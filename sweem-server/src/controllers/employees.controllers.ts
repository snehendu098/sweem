import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { employees, employeeTokenRates, paymentGroups } from '../db/schema'
import { computeSlicePerMs } from '../lib/slice'
import type { AuthEnv } from '../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRate = any

export async function createEmployee(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const [employee] = await db
    .insert(employees)
    .values({
      alias: body.alias,
      walletAddress: body.wallet_address,
      orgWallet: c.req.param('wallet')!,
      groupId: body.group_id ?? null,
      email: body.email ?? null,
    })
    .returning()

  if (body.rates?.length) {
    await db.insert(employeeTokenRates).values(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body.rates.map((r: any) => ({
        employeeId: employee.id,
        token: r.token,
        rateAmount: r.rate_amount != null ? String(r.rate_amount) : null,
        rateType: r.rate_type ?? null,
        percentage: r.percentage != null ? String(r.percentage) : null,
      })),
    )
  }

  return c.json(employee, 201)
}

export async function listEmployees(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const list = await db.query.employees.findMany({
    where: eq(employees.orgWallet, c.req.param('wallet')!),
    with: { rates: true },
  })

  const enriched = list.map((emp) => ({
    ...emp,
    rates: emp.rates.map((r) => ({
      ...r,
      slice_per_ms:
        r.rateAmount && r.rateType
          ? computeSlicePerMs(Number(r.rateAmount), r.rateType as 'MONTHLY' | 'HOURLY')
          : null,
    })),
  }))

  return c.json(enriched)
}

export async function updateEmployee(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const employeeId = c.req.param('employee_id')!

  let updated = null
  if ('group_id' in body) {
    const [row] = await db
      .update(employees)
      .set({ groupId: body.group_id ?? null })
      .where(eq(employees.id, employeeId))
      .returning()
    if (!row) throw new HTTPException(404, { message: 'Employee not found' })
    updated = row
  }

  if (Array.isArray(body.rates)) {
    await db.delete(employeeTokenRates).where(eq(employeeTokenRates.employeeId, employeeId))
    if (body.rates.length) {
      await db.insert(employeeTokenRates).values(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body.rates.map((r: any) => ({
          employeeId,
          token: r.token,
          rateAmount: r.rate_amount != null ? String(r.rate_amount) : null,
          rateType: r.rate_type ?? null,
          percentage: r.percentage != null ? String(r.percentage) : null,
        })),
      )
    }
  }

  return c.json(updated ?? { updated: true })
}

export async function deleteEmployee(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const [deleted] = await db
    .delete(employees)
    .where(eq(employees.id, c.req.param('employee_id')!))
    .returning()
  if (!deleted) throw new HTTPException(404, { message: 'Employee not found' })
  return c.json({ deleted: true })
}

// POST /:wallet/employees/bulk — CSV import (UPSERT). Resolves/creates groups by
// name, inserts new employees, and UPDATES existing ones (matched on
// (wallet_address, org_wallet)) — refreshing alias/email/group and replacing
// their rates. Returns a detailed per-outcome report.
export async function bulkCreateEmployees(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = body.employees

  // Resolve group names → ids (create missing). Case-insensitive map.
  const existingGroups = await db.query.paymentGroups.findMany({
    where: eq(paymentGroups.orgWallet, orgWallet),
  })
  const groupIdByName = new Map(existingGroups.map((g) => [g.name.toLowerCase(), g.id]))

  const wantedNames = [
    ...new Set(
      rows
        .map((r) => (r.group_name ? String(r.group_name).trim() : ''))
        .filter((n) => n && !groupIdByName.has(n.toLowerCase())),
    ),
  ]
  for (const name of wantedNames) {
    const [g] = await db.insert(paymentGroups).values({ orgWallet, name }).returning()
    groupIdByName.set(name.toLowerCase(), g.id)
  }

  // Existing roster, keyed by lowercased wallet, so we know insert vs update.
  const roster = await db.query.employees.findMany({ where: eq(employees.orgWallet, orgWallet) })
  const idByWallet = new Map(roster.map((e) => [e.walletAddress.toLowerCase(), e.id]))

  let created = 0
  let updated = 0
  const failed: { wallet_address: string; message: string }[] = []

  const replaceRates = async (employeeId: string, rates: AnyRate[] | undefined) => {
    await db.delete(employeeTokenRates).where(eq(employeeTokenRates.employeeId, employeeId))
    if (rates?.length) {
      await db.insert(employeeTokenRates).values(
        rates.map((r: AnyRate) => ({
          employeeId,
          token: r.token,
          rateAmount: r.rate_amount != null ? String(r.rate_amount) : null,
          rateType: r.rate_type ?? null,
          percentage: r.percentage != null ? String(r.percentage) : null,
        })),
      )
    }
  }

  for (const row of rows) {
    try {
      const groupId =
        row.group_id ??
        (row.group_name
          ? groupIdByName.get(String(row.group_name).trim().toLowerCase()) ?? null
          : null)

      const key = String(row.wallet_address).toLowerCase()
      const existingId = idByWallet.get(key)

      if (existingId) {
        await db
          .update(employees)
          .set({ alias: row.alias, email: row.email ?? null, groupId })
          .where(eq(employees.id, existingId))
        await replaceRates(existingId, row.rates)
        updated++
      } else {
        const [emp] = await db
          .insert(employees)
          .values({
            alias: row.alias,
            walletAddress: row.wallet_address,
            orgWallet,
            groupId,
            email: row.email ?? null,
          })
          .returning()
        await replaceRates(emp.id, row.rates)
        idByWallet.set(key, emp.id) // dedupe repeats within the same request
        created++
      }
    } catch (e) {
      failed.push({ wallet_address: row.wallet_address, message: (e as Error).message })
    }
  }

  // `skipped` kept for backwards compatibility (always empty now — duplicates update).
  return c.json({ created, updated, skipped: [], failed }, 201)
}
