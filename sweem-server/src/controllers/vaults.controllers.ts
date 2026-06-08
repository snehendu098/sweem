import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { employeeVaults, vaultAllocations } from '../db/schema'
import { createSuiClient, getObjectFields } from '../lib/sui'
import type { AuthEnv } from '../types'

export async function createVault(c: Context<AuthEnv>) {
  const body = await c.req.json()
  const db = createDb(c.env.DB.connectionString)

  const [vault] = await db
    .insert(employeeVaults)
    .values({
      employeeWallet: c.var.walletAddress,
      name: body.name,
      onChainVaultId: body.on_chain_vault_id,
    })
    .returning()

  return c.json(vault, 201)
}

export async function listVaults(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const sui = createSuiClient(c.env.SUI_NETWORK)

  const vaults = await db.query.employeeVaults.findMany({
    where: eq(employeeVaults.employeeWallet, c.req.param('wallet')!),
  })

  const enriched = await Promise.all(
    vaults.map(async (vault) => {
      const fields = await getObjectFields(sui, vault.onChainVaultId)
      return { ...vault, on_chain: fields }
    }),
  )

  return c.json(enriched)
}

export async function getAllocation(c: Context<AuthEnv>) {
  const db = createDb(c.env.DB.connectionString)
  const allocations = await db.query.vaultAllocations.findMany({
    where: eq(vaultAllocations.vaultId, c.req.param('vault_id')!),
  })
  return c.json(allocations)
}

export async function updateAllocation(c: Context<AuthEnv>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const vaultId = c.req.param('vault_id')!

  await db.delete(vaultAllocations).where(eq(vaultAllocations.vaultId, vaultId))
  const inserted = await db
    .insert(vaultAllocations)
    .values(
      body.map((a) => ({
        vaultId,
        token: a.token,
        yieldType: a.yield_type,
        percentage: String(a.percentage),
        protocol: a.protocol,
      })),
    )
    .returning()

  return c.json(inserted)
}
