import { z } from 'zod'

// headers + a few sample rows is all the AI needs to infer column mapping.
export const mapCsvSchema = z.object({
  headers: z.array(z.string()).min(1).max(64),
  samples: z.array(z.array(z.string())).max(10),
})
