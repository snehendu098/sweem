import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { mapCsv, chatHandler } from '../controllers/ai.controllers'
import { mapCsvSchema } from '../schemas/ai.schema'

const ai = new Hono<AuthEnv>()

ai.post('/map-csv', authMiddleware, zValidator('json', mapCsvSchema), mapCsv)
ai.post('/chat', chatHandler)

export default ai
