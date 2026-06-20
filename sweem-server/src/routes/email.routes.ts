import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { startEmailVerification, confirmEmailVerification } from '../controllers/email.controllers'
import { startEmailSchema, confirmEmailSchema } from '../schemas/email.schema'

const email = new Hono<AuthEnv>()

email.post('/start', authMiddleware, zValidator('json', startEmailSchema), startEmailVerification)
email.post('/confirm', authMiddleware, zValidator('json', confirmEmailSchema), confirmEmailVerification)

export default email
