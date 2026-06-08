import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { AuthEnv } from '../types'
import { verifyWalletSignature } from '../lib/auth'

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const walletAddress = c.req.header('X-Wallet-Address')
  const signature     = c.req.header('X-Signature')
  const message       = c.req.header('X-Message')

  if (!walletAddress || !signature || !message) {
    throw new HTTPException(401, { message: 'Missing auth headers' })
  }

  const valid = await verifyWalletSignature(walletAddress, message, signature)
  if (!valid) throw new HTTPException(401, { message: 'Invalid signature' })

  c.set('walletAddress', walletAddress)
  await next()
})
