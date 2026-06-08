import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createGroup, listGroups, deleteGroup } from '../controllers/groups.controllers'
import { createGroupSchema } from '../schemas/groups.schema'
import poolRoutes from './pools.routes'
import employeeRoutes from './employees.routes'

const groups = new Hono<AuthEnv>()

groups.post('/', authMiddleware, zValidator('json', createGroupSchema), createGroup)
groups.get('/', listGroups)
groups.delete('/:group_id', authMiddleware, deleteGroup)

groups.route('/:group_id/pools', poolRoutes)
groups.route('/:group_id/employees', employeeRoutes)

export default groups
