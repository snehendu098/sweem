import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './types'
import orgRoutes      from './routes/orgs.routes'
import vaultRoutes    from './routes/vaults.routes'
import computeRoutes  from './routes/compute.routes'
import aiRoutes       from './routes/ai.routes'
import employeeRoutes from './routes/employee.routes'
import { serveAttachment } from './controllers/invoices.controllers'

const app = new Hono<AppEnv>()

// CORS — required for the browser client (client-test). Allowed origins come from
// the ALLOWED_ORIGIN env var (comma-separated); defaults to the local Next.js dev
// origin. We echo back the request origin when it is in the allowlist.
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = (c.env.ALLOWED_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o: string) => o.trim())
    return allowed.includes(origin) ? origin : (allowed[0] ?? null)
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Wallet-Address', 'X-Signature', 'X-Message'],
  maxAge: 600,
}))

app.route('/v1/orgs',     orgRoutes)
app.route('/v1/vaults',   vaultRoutes)
app.route('/v1/compute',  computeRoutes)
app.route('/v1/ai',       aiRoutes)
app.route('/v1/employee', employeeRoutes)
app.get('/v1/attachments/:wallet/:file', serveAttachment)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: 'http_error', message: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'internal_error', message: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404))

export default app
