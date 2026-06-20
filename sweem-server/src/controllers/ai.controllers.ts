import type { Context } from 'hono'
import { inferMapping } from '../lib/csv-mapping'
import type { AuthEnv } from '../types'

// POST /v1/ai/map-csv — given CSV headers + sample rows, return a column → field
// mapping. Auth-gated (any registered wallet) to avoid open AI usage.
export async function mapCsv(c: Context<AuthEnv>) {
  const { headers, samples } = await c.req.json()
  const result = await inferMapping(c.env, headers, samples ?? [])
  return c.json(result)
}
