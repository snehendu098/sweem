import Papa from 'papaparse'
import { isValidSuiAddress } from '@mysten/sui/utils'
import type { BulkEmployeeInput, RateInput } from './api'
import { TOKEN_SYMBOLS, type TokenSymbol } from './tokens'

// ===========================================================================
// Robust CSV ingestion for employee onboarding.
//
// Pipeline: parse -> map columns (header heuristics + fuzzy + content sniffing)
// -> normalize -> validate -> dedupe -> classify (new / update / invalid).
// Everything runs locally and deterministically; no backend round-trip is
// needed to map a file, so onboarding stays instant.
// ===========================================================================

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export type MappingField =
  | 'alias'
  | 'wallet_address'
  | 'email'
  | 'rate_amount'
  | 'rate_type'
  | 'group'
  | 'token'

export type RowAction = 'new' | 'update' | 'invalid'

// One import row after mapping + normalization. `errors` empty => importable.
export interface ParsedEmployee {
  alias: string
  wallet_address: string
  email: string | null
  group_name: string | null
  rate_amount: number | null
  rate_type: 'MONTHLY' | 'HOURLY'
  token: TokenSymbol
  errors: string[]
  warnings: string[]
  action: RowAction
}

// How a single field was resolved, for the mapping summary shown to the user.
export interface FieldResolution {
  field: MappingField
  header: string | null // chosen CSV header, or null if unmapped
  via: 'header' | 'content' | 'none'
}

export interface IngestResult {
  rows: ParsedEmployee[]
  resolutions: FieldResolution[]
  ignoredHeaders: string[] // extra/unrecognized columns
  totalRows: number
}

// ----- parsing -------------------------------------------------------------

// Parse a CSV File into headers + string rows. Empty/blank lines are dropped.
export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const all = res.data.filter(
          (r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''),
        )
        if (all.length === 0) return reject(new Error('CSV is empty'))
        const [headers, ...rows] = all
        resolve({
          headers: headers.map((h) => String(h ?? '').trim()),
          rows: rows.map((r) => r.map((c) => String(c ?? ''))),
        })
      },
      error: (err) => reject(err),
    })
  })
}

// ----- normalization helpers ----------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Strip currency symbols, thousands separators and suffixes, returning a number.
// Handles "$1,200.50", "1 200,50", "12k", "1.2m", "USDC 500".
export function normalizeAmount(raw: string): number | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase().replace(/[a-z$€£₹\s]/gi, (m) => (/[km]/i.test(m) ? m : ''))
  // suffixes
  let mult = 1
  if (/k$/i.test(s)) {
    mult = 1_000
    s = s.replace(/k$/i, '')
  } else if (/m$/i.test(s)) {
    mult = 1_000_000
    s = s.replace(/m$/i, '')
  }
  // If both , and . present, assume , is thousands sep. If only , present and it
  // looks like a decimal (one group of 1-2 trailing digits), treat as decimal.
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (s.includes(',') && !s.includes('.')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  s = s.replace(/[^0-9.\-]/g, '')
  if (!s) return null
  const n = Number.parseFloat(s) * mult
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : null
}

export function normalizeRateType(
  raw: string | undefined,
  fallback: 'MONTHLY' | 'HOURLY' = 'MONTHLY',
): 'MONTHLY' | 'HOURLY' {
  if (!raw) return fallback
  const v = raw.toLowerCase()
  if (/hour|hr|hourly|\/h/.test(v)) return 'HOURLY'
  if (/month|mo\b|monthly|annual|year|yr|salary/.test(v)) return 'MONTHLY'
  return fallback
}

function normalizeToken(raw: string): TokenSymbol {
  const v = raw.toUpperCase()
  return TOKEN_SYMBOLS.find((s) => v.includes(s)) ?? 'USDC'
}

function normalizeWallet(raw: string): string {
  return raw.trim().replace(/\s+/g, '')
}

// ----- column mapping ------------------------------------------------------

// Header synonyms per field (priority order). Matched against normalized headers.
const SYNONYMS: Record<MappingField, string[]> = {
  alias: ['alias', 'fullname', 'employeename', 'name', 'employee', 'displayname', 'firstname', 'person', 'member', 'contact'],
  wallet_address: ['walletaddress', 'suiaddress', 'suiwallet', 'wallet', 'address', 'recipient', 'account', 'payto', 'sui', 'destination'],
  email: ['emailaddress', 'email', 'workemail', 'mail', 'e'],
  rate_amount: ['rateamount', 'monthlysalary', 'salary', 'compensation', 'monthly', 'rate', 'amount', 'wage', 'pay', 'income', 'ctc'],
  rate_type: ['ratetype', 'frequency', 'cadence', 'period', 'paytype', 'paycycle', 'type', 'interval'],
  group: ['groupname', 'group', 'department', 'dept', 'team', 'division', 'role', 'title', 'designation'],
  token: ['token', 'currency', 'coin', 'asset', 'paymenttoken'],
}

// Levenshtein distance (small inputs, fine for header matching).
function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[n]
}

// Score how well a normalized header matches a field by its synonyms (0..100).
function headerScore(field: MappingField, nHeader: string): number {
  if (!nHeader) return 0
  let best = 0
  for (const kw of SYNONYMS[field]) {
    if (nHeader === kw) return 100
    if (kw.length >= 3 && nHeader.includes(kw)) best = Math.max(best, 82)
    if (nHeader.length >= 3 && kw.includes(nHeader)) best = Math.max(best, 72)
    const dist = lev(nHeader, kw)
    const ratio = 1 - dist / Math.max(nHeader.length, kw.length)
    if (ratio >= 0.8) best = Math.max(best, Math.round(60 * ratio))
  }
  return best
}

// Content sniffers — fraction (0..1) of sample values that look like the field.
const looksWallet = (v: string) => /^0x[0-9a-fA-F]{6,64}$/.test(v.trim())
const looksEmail = (v: string) => EMAIL_RE.test(v.trim())
const looksAmount = (v: string) => normalizeAmount(v) != null
const looksRateType = (v: string) => /hour|hr|month|mo|annual|year|weekly|biweekly/i.test(v)
const looksToken = (v: string) => TOKEN_SYMBOLS.some((s) => v.toUpperCase().includes(s))
const looksName = (v: string) =>
  /[a-zA-Z]/.test(v) && !looksWallet(v) && !looksEmail(v) && !/^[\d.,$\s]+$/.test(v)

function columnContentScore(field: MappingField, values: string[]): number {
  const nonEmpty = values.filter((v) => v.trim() !== '')
  if (nonEmpty.length === 0) return 0
  const test =
    field === 'wallet_address'
      ? looksWallet
      : field === 'email'
        ? looksEmail
        : field === 'rate_amount'
          ? looksAmount
          : field === 'rate_type'
            ? looksRateType
            : field === 'token'
              ? looksToken
              : field === 'alias'
                ? looksName
                : null
  if (!test) return 0
  const hits = nonEmpty.filter(test).length
  return hits / nonEmpty.length
}

const SAMPLE_LIMIT = 50 // rows scanned for content sniffing (perf on big files)

// Map each field to a column index (-1 = unmapped). Header heuristics win first;
// content sniffing fills the gaps using the actual cell values.
function mapColumns(csv: ParsedCsv): { idx: Record<MappingField, number>; via: Record<MappingField, FieldResolution['via']> } {
  const { headers, rows } = csv
  const nHeaders = headers.map(norm)
  const fields: MappingField[] = ['wallet_address', 'email', 'rate_amount', 'alias', 'group', 'rate_type', 'token']
  const idx = Object.fromEntries(fields.map((f) => [f, -1])) as Record<MappingField, number>
  const via = Object.fromEntries(fields.map((f) => [f, 'none'])) as Record<MappingField, FieldResolution['via']>
  const takenCols = new Set<number>()

  // Pass 1: header-based, greedy by best score across all (field, header) pairs.
  const pairs: { field: MappingField; col: number; score: number }[] = []
  for (const field of fields) {
    headers.forEach((_, col) => {
      const score = headerScore(field, nHeaders[col])
      if (score >= 55) pairs.push({ field, col, score })
    })
  }
  pairs.sort((a, b) => b.score - a.score)
  const fieldDone = new Set<MappingField>()
  for (const p of pairs) {
    if (fieldDone.has(p.field) || takenCols.has(p.col)) continue
    idx[p.field] = p.col
    via[p.field] = 'header'
    fieldDone.add(p.field)
    takenCols.add(p.col)
  }

  // Pass 2: content sniffing for unmapped fields (skip rate_type/token: low signal).
  const sample = rows.slice(0, SAMPLE_LIMIT)
  const contentFields: MappingField[] = ['wallet_address', 'email', 'rate_amount', 'token', 'rate_type', 'alias']
  for (const field of contentFields) {
    if (idx[field] !== -1) continue
    let bestCol = -1
    let bestScore = 0
    headers.forEach((_, col) => {
      if (takenCols.has(col)) return
      const values = sample.map((r) => r[col] ?? '')
      const score = columnContentScore(field, values)
      if (score > bestScore) {
        bestScore = score
        bestCol = col
      }
    })
    // Require strong content signal (looser for alias, which is just "text").
    const threshold = field === 'alias' ? 0.6 : field === 'rate_amount' ? 0.7 : 0.8
    if (bestCol !== -1 && bestScore >= threshold) {
      idx[field] = bestCol
      via[field] = 'content'
      takenCols.add(bestCol)
    }
  }

  return { idx, via }
}

// ----- validation ----------------------------------------------------------

function validate(r: {
  alias: string
  wallet_address: string
  email: string | null
  rate_amount: number | null
}): string[] {
  const errs: string[] = []
  if (!r.alias) errs.push('Missing name')
  if (!r.wallet_address) errs.push('Missing wallet')
  else if (!isValidSuiAddress(r.wallet_address)) errs.push('Invalid Sui address')
  if (r.rate_amount == null) errs.push('Missing/invalid rate')
  if (r.email && !EMAIL_RE.test(r.email)) errs.push('Invalid email')
  return errs
}

// ----- public entry --------------------------------------------------------

// Full ingestion: map + normalize + validate + dedupe + classify. `existingWallets`
// (lowercased) lets us flag rows that will UPDATE an existing employee vs create.
export function ingestCsv(csv: ParsedCsv, existingWallets: Set<string> = new Set()): IngestResult {
  const { idx, via } = mapColumns(csv)
  const cell = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '')

  const seen = new Set<string>() // wallets seen earlier in THIS file
  const rows: ParsedEmployee[] = csv.rows.map((row) => {
    const alias = cell(row, idx.alias)
    const wallet_address = normalizeWallet(cell(row, idx.wallet_address))
    const emailRaw = cell(row, idx.email)
    const groupRaw = cell(row, idx.group)
    const rate_amount = normalizeAmount(cell(row, idx.rate_amount))
    const rate_type = normalizeRateType(cell(row, idx.rate_type) || undefined)
    const token = idx.token >= 0 ? normalizeToken(cell(row, idx.token)) : 'USDC'

    const errors = validate({ alias, wallet_address, email: emailRaw || null, rate_amount })
    const warnings: string[] = []

    // Duplicate within the same file.
    const key = wallet_address.toLowerCase()
    if (wallet_address && isValidSuiAddress(wallet_address)) {
      if (seen.has(key)) errors.push('Duplicate row in file')
      else seen.add(key)
    }
    if (!emailRaw) warnings.push('No email')
    if (idx.rate_type < 0 && rate_amount != null) warnings.push('Rate type defaulted to monthly')

    const isUpdate = !errors.length && existingWallets.has(key)
    const action: RowAction = errors.length ? 'invalid' : isUpdate ? 'update' : 'new'

    return {
      alias,
      wallet_address,
      email: emailRaw || null,
      group_name: groupRaw || null,
      rate_amount,
      rate_type,
      token,
      errors,
      warnings,
      action,
    }
  })

  const mappedCols = new Set(Object.values(idx).filter((i) => i >= 0))
  const ignoredHeaders = csv.headers.filter((_, i) => !mappedCols.has(i))
  const resolutions: FieldResolution[] = (
    ['alias', 'wallet_address', 'rate_amount', 'rate_type', 'email', 'group', 'token'] as MappingField[]
  ).map((field) => ({ field, header: idx[field] >= 0 ? csv.headers[idx[field]] : null, via: via[field] }))

  return { rows, resolutions, ignoredHeaders, totalRows: csv.rows.length }
}

// Re-validate a single (possibly hand-edited) row, recomputing action.
export function revalidate(r: ParsedEmployee, existingWallets: Set<string> = new Set()): ParsedEmployee {
  const errors = validate({
    alias: r.alias,
    wallet_address: r.wallet_address,
    email: r.email,
    rate_amount: r.rate_amount,
  })
  const key = r.wallet_address.toLowerCase()
  const action: RowAction = errors.length ? 'invalid' : existingWallets.has(key) ? 'update' : 'new'
  return { ...r, errors, action }
}

// Convert importable rows (no errors) into the bulk API payload.
export function toBulkInput(rows: ParsedEmployee[]): BulkEmployeeInput[] {
  return rows
    .filter((r) => r.errors.length === 0 && r.rate_amount != null)
    .map((r) => {
      const rates: RateInput[] = [
        { token: r.token, rate_amount: r.rate_amount as number, rate_type: r.rate_type },
      ]
      return {
        alias: r.alias,
        wallet_address: r.wallet_address,
        email: r.email,
        group_name: r.group_name,
        rates,
      }
    })
}

const FIELD_LABELS: Record<MappingField, string> = {
  alias: 'Name',
  wallet_address: 'Wallet',
  rate_amount: 'Rate',
  rate_type: 'Rate type',
  email: 'Email',
  group: 'Group',
  token: 'Token',
}

export function fieldLabel(f: MappingField): string {
  return FIELD_LABELS[f]
}
