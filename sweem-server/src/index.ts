import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './types'
import orgRoutes     from './routes/orgs.routes'
import vaultRoutes   from './routes/vaults.routes'
import computeRoutes from './routes/compute.routes'

const app = new Hono<AppEnv>()

app.route('/v1/orgs',    orgRoutes)
app.route('/v1/vaults',  vaultRoutes)
app.route('/v1/compute', computeRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: 'http_error', message: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'internal_error', message: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404))

export default app
