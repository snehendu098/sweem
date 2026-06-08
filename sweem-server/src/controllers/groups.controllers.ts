import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { paymentGroups } from '../db/schema'
import type { AuthEnv } from '../types'

export async function createGroup(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const [group] = await db
    .insert(paymentGroups)
    .values({ orgWallet: c.req.param('wallet')!, name: body.name })
    .returning()

  return c.json(group, 201)
}

export async function listGroups(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const groups = await db.query.paymentGroups.findMany({
    where: eq(paymentGroups.orgWallet, c.req.param('wallet')!),
  })
  return c.json(groups)
}

export async function deleteGroup(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const [deleted] = await db
    .delete(paymentGroups)
    .where(eq(paymentGroups.id, c.req.param('group_id')!))
    .returning()
  if (!deleted) throw new HTTPException(404, { message: 'Group not found' })
  return c.json({ deleted: true })
}
