import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createOrg, getOrg, updateOrg } from '../controllers/orgs.controllers'
import { createOrgSchema, updateOrgSchema } from '../schemas/orgs.schema'
import groupRoutes from './groups.routes'

const orgs = new Hono<AuthEnv>()

orgs.post('/', authMiddleware, zValidator('json', createOrgSchema), createOrg)
orgs.get('/:wallet', getOrg)
orgs.put('/:wallet', authMiddleware, zValidator('json', updateOrgSchema), updateOrg)

orgs.route('/:wallet/groups', groupRoutes)

export default orgs
