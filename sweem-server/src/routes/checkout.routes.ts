import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { getCheckoutConfig } from '../controllers/keys.controllers'

// PUBLIC checkout routes consumed by the @sweem/react SDK from merchant sites.
const checkout = new Hono<AppEnv>()

checkout.get('/config', getCheckoutConfig)

export default checkout
