import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createKey, listKeys, revokeKey } from '../controllers/keys.controllers'
import { createKeySchema } from '../schemas/keys.schema'

// Mounted at /v1/orgs/:wallet/keys — inherits :wallet from the parent router.
const keys = new Hono<AuthEnv>()

keys.get('/', listKeys)
keys.post('/', authMiddleware, zValidator('json', createKeySchema), createKey)
keys.delete('/:id', authMiddleware, revokeKey)

export default keys
