import type { Context } from 'hono'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { apiKeys, organizations } from '../db/schema'
import type { AppEnv, AuthEnv } from '../types'

// Publishable key: pk_live_<48 hex chars>. Generated with the Workers crypto API.
function genKey(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `pk_live_${hex}`
}

// POST /v1/orgs/:wallet/keys — create a publishable key. Auth wallet must own the org.
export async function createKey(c: Context<AuthEnv>) {
  const wallet = c.req.param('wallet')!
  if (c.var.walletAddress !== wallet) throw new HTTPException(403, { message: 'Forbidden' })
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.walletAddress, wallet),
  })
  if (!org) throw new HTTPException(404, { message: 'Register your organization first' })

  const [row] = await db
    .insert(apiKeys)
    .values({
      orgWallet: wallet,
      name: body.name,
      key: genKey(),
      receivingAddress: body.receiving_address ?? null,
    })
    .returning()

  return c.json(row, 201)
}

// GET /v1/orgs/:wallet/keys — list an org's active keys (newest first). Publishable
// keys + receiving address are client-safe, so this read needs no signature.
export async function listKeys(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const rows = await db.query.apiKeys.findMany({
    where: and(eq(apiKeys.orgWallet, c.req.param('wallet')!), isNull(apiKeys.revokedAt)),
    orderBy: [desc(apiKeys.createdAt)],
  })
  return c.json(rows)
}

// DELETE /v1/orgs/:wallet/keys/:id — soft-revoke a key (auth wallet must own the org).
export async function revokeKey(c: Context<AuthEnv>) {
  const wallet = c.req.param('wallet')!
  if (c.var.walletAddress !== wallet) throw new HTTPException(403, { message: 'Forbidden' })
  const db = createDb(c.env.DB.connectionString)
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, c.req.param('id')!), eq(apiKeys.orgWallet, wallet)))
    .returning()
  if (!row) throw new HTTPException(404, { message: 'Key not found' })
  return c.json({ revoked: true })
}

// GET /v1/checkout/config?pk=… — PUBLIC. The SDK calls this from any merchant
// site to resolve a publishable key into checkout config. No wallet auth.
export async function getCheckoutConfig(c: Context<AppEnv>) {
  const pk = c.req.query('pk')
  if (!pk) throw new HTTPException(400, { message: 'Missing pk' })

  const db = createDb(c.env.DB.connectionString)
  const key = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.key, pk), isNull(apiKeys.revokedAt)),
  })
  if (!key) throw new HTTPException(404, { message: 'Invalid API key' })

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.walletAddress, key.orgWallet),
  })

  return c.json({
    merchant: org?.name ?? 'Merchant',
    logoUrl: org?.logoUrl ?? null,
    recipient: key.receivingAddress ?? key.orgWallet,
    tokens: ['USDC', 'SUI'],
  })
}
