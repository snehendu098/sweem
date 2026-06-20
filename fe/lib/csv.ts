import Papa from 'papaparse'
import { isValidSuiAddress } from '@mysten/sui/utils'
import type { ColumnMapping, BulkEmployeeInput, RateInput } from './api'

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

// One import row after mapping + normalization. `errors` empty ⇒ ready to submit.
export interface ParsedEmployee {
  alias: string
  wallet_address: string
  email: string | null
  group_name: string | null
  rate_amount: number | null
  rate_type: 'MONTHLY' | 'HOURLY'
  errors: string[]
}

// Parse a CSV File into headers + string rows (header row consumed, blanks dropped).
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const all = res.data.filter((r) => Array.isArray(r) && r.some((c) => String(c).trim() !== ''))
        if (all.length === 0) return reject(new Error('CSV is empty'))
        const [headers, ...rows] = all
        resolve({ headers: headers.map((h) => String(h).trim()), rows: rows.map((r) => r.map((c) => String(c ?? ''))) })
      },
      error: (err) => reject(err),
    })
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function colIndex(headers: string[], name: string | null): number {
  if (!name) return -1
  return headers.indexOf(name)
}

function normalizeAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  if (!cleaned) return null
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeRateType(raw: string | undefined, fallback: 'MONTHLY' | 'HOURLY'): 'MONTHLY' | 'HOURLY' {
  if (!raw) return fallback
  const v = raw.toLowerCase()
  if (v.includes('hour') || v.includes('hr') || v.includes('hourly')) return 'HOURLY'
  if (v.includes('month') || v.includes('mo') || v.includes('annual') || v.includes('year')) return 'MONTHLY'
  return fallback
}

// Apply the AI/heuristic column mapping to every row + validate. Pure + deterministic.
export function applyMapping(
  csv: ParsedCsv,
  mapping: ColumnMapping,
  defaults: { rate_type: 'MONTHLY' | 'HOURLY' },
): ParsedEmployee[] {
  const { headers, rows } = csv
  const idx = {
    alias: colIndex(headers, mapping.alias),
    wallet: colIndex(headers, mapping.wallet_address),
    email: colIndex(headers, mapping.email),
    amount: colIndex(headers, mapping.rate_amount),
    rateType: colIndex(headers, mapping.rate_type),
    group: colIndex(headers, mapping.group),
  }
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

  return rows.map((row) => {
    const alias = cell(row, idx.alias)
    const wallet_address = cell(row, idx.wallet)
    const emailRaw = cell(row, idx.email)
    const groupRaw = cell(row, idx.group)
    const rate_amount = normalizeAmount(cell(row, idx.amount))
    const rate_type = normalizeRateType(cell(row, idx.rateType) || undefined, defaults.rate_type)

    return { alias, wallet_address, email: emailRaw || null, group_name: groupRaw || null, rate_amount, rate_type, errors: validate({ alias, wallet_address, email: emailRaw, rate_amount }) }
  })
}

function validate(r: { alias: string; wallet_address: string; email: string; rate_amount: number | null }): string[] {
  const errs: string[] = []
  if (!r.alias) errs.push('Missing name')
  if (!r.wallet_address) errs.push('Missing wallet')
  else if (!isValidSuiAddress(r.wallet_address)) errs.push('Invalid Sui address')
  if (r.rate_amount == null) errs.push('Missing/invalid rate')
  if (r.email && !EMAIL_RE.test(r.email)) errs.push('Invalid email')
  return errs
}

// Re-validate a single (possibly hand-edited) row.
export function revalidate(r: ParsedEmployee): ParsedEmployee {
  return { ...r, errors: validate({ alias: r.alias, wallet_address: r.wallet_address, email: r.email ?? '', rate_amount: r.rate_amount }) }
}

// Convert ready rows → bulk API payload.
export function toBulkInput(rows: ParsedEmployee[]): BulkEmployeeInput[] {
  return rows
    .filter((r) => r.errors.length === 0 && r.rate_amount != null)
    .map((r) => {
      const rates: RateInput[] = [{ token: 'USDC', rate_amount: r.rate_amount as number, rate_type: r.rate_type }]
      return {
        alias: r.alias,
        wallet_address: r.wallet_address,
        email: r.email,
        group_name: r.group_name,
        rates,
      }
    })
}
