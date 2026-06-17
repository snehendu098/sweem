import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { employees, employeeTokenRates } from '../db/schema'
import { computeSlicePerMs } from '../lib/slice'
import type { AuthEnv } from '../types'

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
