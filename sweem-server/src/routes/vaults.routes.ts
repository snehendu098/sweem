import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createVault, listVaults, getAllocation, updateAllocation } from '../controllers/vaults.controllers'
import { createVaultSchema, updateAllocationSchema } from '../schemas/vaults.schema'

const vaults = new Hono<AuthEnv>()

vaults.post('/', authMiddleware, zValidator('json', createVaultSchema), createVault)
vaults.get('/:wallet', listVaults)
vaults.get('/:vault_id/allocation', getAllocation)
vaults.put('/:vault_id/allocation', authMiddleware, zValidator('json', updateAllocationSchema), updateAllocation)

export default vaults
