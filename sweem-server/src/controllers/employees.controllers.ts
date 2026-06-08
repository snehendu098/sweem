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
      paymentGroupId: c.req.param('group_id')!,
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
    where: eq(employees.paymentGroupId, c.req.param('group_id')!),
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

export async function updateRates(c: Context<AuthEnv>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const employeeId = c.req.param('employee_id')!

  await db.delete(employeeTokenRates).where(eq(employeeTokenRates.employeeId, employeeId))
  await db.insert(employeeTokenRates).values(
    body.map((r) => ({
      employeeId,
      token: r.token,
      rateAmount: r.rate_amount != null ? String(r.rate_amount) : null,
      rateType: r.rate_type ?? null,
      percentage: r.percentage != null ? String(r.percentage) : null,
    })),
  )

  return c.json({ updated: true })
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
