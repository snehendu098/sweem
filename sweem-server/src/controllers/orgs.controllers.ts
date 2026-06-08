import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { organizations } from '../db/schema'
import type { AuthEnv } from '../types'

export async function createOrg(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.walletAddress, c.var.walletAddress),
  })
  if (existing) throw new HTTPException(409, { message: 'Org already registered' })

  const [org] = await db
    .insert(organizations)
    .values({ walletAddress: c.var.walletAddress, name: body.name, logoUrl: body.logo_url })
    .returning()

  return c.json(org, 201)
}

export async function getOrg(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.walletAddress, c.req.param('wallet')!),
  })
  if (!org) throw new HTTPException(404, { message: 'Org not found' })
  return c.json(org)
}

export async function updateOrg(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const [updated] = await db
    .update(organizations)
    .set({ ...(body.name && { name: body.name }), ...(body.logo_url && { logoUrl: body.logo_url }) })
    .where(eq(organizations.walletAddress, c.var.walletAddress))
    .returning()

  if (!updated) throw new HTTPException(404, { message: 'Org not found' })
  return c.json(updated)
}
