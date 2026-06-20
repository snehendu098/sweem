import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { createDb } from '../db/client'
import { organizations, emailVerifications } from '../db/schema'
import { generateOtp, hashOtp, safeEqual } from '../lib/otp'
import { sendOtpEmail } from '../lib/resend'
import type { AuthEnv } from '../types'

const OTP_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

// POST /:wallet/email/start — store the (unverified) org email, generate an OTP,
// email it via Resend, and persist only its hash. In EMAIL_DEV_MODE the code is
// returned so the flow is demoable without a verified sending domain.
export async function startEmailVerification(c: Context<AuthEnv>) {
  const { email } = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.walletAddress, orgWallet),
  })
  if (!org) throw new HTTPException(404, { message: 'Org not found' })

  const code = generateOtp()
  const salt = c.env.VERIFICATION_SALT || 'sweem-dev-salt'
  const codeHash = await hashOtp(code, salt)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  // Store the email unverified, and upsert the pending verification.
  await db
    .update(organizations)
    .set({ email, emailVerifiedAt: null })
    .where(eq(organizations.walletAddress, orgWallet))

  await db
    .insert(emailVerifications)
    .values({ orgWallet, email, codeHash, expiresAt, attempts: '0' })
    .onConflictDoUpdate({
      target: emailVerifications.orgWallet,
      set: { email, codeHash, expiresAt, attempts: '0', createdAt: new Date() },
    })

  const { sent, error } = await sendOtpEmail(c.env, email, code)
  const devMode = c.env.EMAIL_DEV_MODE === 'true'

  return c.json({
    ok: true,
    sent,
    ...(error && { sendError: error }),
    ...(devMode && { devMode: true, code }),
  })
}

// POST /:wallet/email/confirm — check the OTP, stamp email_verified_at on success.
export async function confirmEmailVerification(c: Context<AuthEnv>) {
  const { code } = await c.req.json()
  const db = createDb(c.env.DB.connectionString)
  const orgWallet = c.req.param('wallet')!

  const pending = await db.query.emailVerifications.findFirst({
    where: eq(emailVerifications.orgWallet, orgWallet),
  })
  if (!pending) throw new HTTPException(400, { message: 'No pending verification' })

  if (pending.expiresAt.getTime() < Date.now()) {
    await db.delete(emailVerifications).where(eq(emailVerifications.orgWallet, orgWallet))
    throw new HTTPException(400, { message: 'Code expired, request a new one' })
  }

  if (Number(pending.attempts) >= MAX_ATTEMPTS) {
    await db.delete(emailVerifications).where(eq(emailVerifications.orgWallet, orgWallet))
    throw new HTTPException(429, { message: 'Too many attempts, request a new code' })
  }

  const salt = c.env.VERIFICATION_SALT || 'sweem-dev-salt'
  const candidate = await hashOtp(code, salt)
  if (!safeEqual(candidate, pending.codeHash)) {
    await db
      .update(emailVerifications)
      .set({ attempts: String(Number(pending.attempts) + 1) })
      .where(eq(emailVerifications.orgWallet, orgWallet))
    throw new HTTPException(400, { message: 'Invalid code' })
  }

  const verifiedAt = new Date()
  await db
    .update(organizations)
    .set({ email: pending.email, emailVerifiedAt: verifiedAt })
    .where(eq(organizations.walletAddress, orgWallet))
  await db.delete(emailVerifications).where(eq(emailVerifications.orgWallet, orgWallet))

  return c.json({ verified: true, email: pending.email, email_verified_at: verifiedAt.toISOString() })
}
