import { describe, it, expect } from 'vitest'
import { createInvoiceSchema, updateInvoiceSchema } from './invoices.schema'

describe('createInvoiceSchema', () => {
  const valid = {
    org_wallet: '0xabc',
    amount: 100,
    token: 'USDC',
    description: 'Travel expenses for client visit',
  }

  it('accepts valid minimal input', () => {
    expect(createInvoiceSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts with optional fields', () => {
    const result = createInvoiceSchema.safeParse({
      ...valid,
      due_date: '2026-07-01',
      attachment_key: '0xwallet/abc123.pdf',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing org_wallet', () => {
    const { org_wallet: _, ...rest } = valid
    expect(createInvoiceSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty org_wallet', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, org_wallet: '' }).success).toBe(false)
  })

  it('rejects zero amount', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false)
  })

  it('rejects negative amount', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, amount: -50 }).success).toBe(false)
  })

  it('rejects empty token', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, token: '' }).success).toBe(false)
  })

  it('rejects empty description', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, description: '' }).success).toBe(false)
  })

  it('rejects description over 500 chars', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, description: 'x'.repeat(501) }).success).toBe(false)
  })

  it('accepts description of exactly 500 chars', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, description: 'x'.repeat(500) }).success).toBe(true)
  })

  it('rejects string amount', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, amount: 'one hundred' }).success).toBe(false)
  })

  it('accepts fractional amount', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, amount: 99.99 }).success).toBe(true)
  })
})

describe('updateInvoiceSchema', () => {
  it('accepts APPROVED', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'APPROVED' }).success).toBe(true)
  })

  it('accepts REJECTED', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'REJECTED' }).success).toBe(true)
  })

  it('accepts PAID', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'PAID' }).success).toBe(true)
  })

  it('accepts REJECTED with note', () => {
    const result = updateInvoiceSchema.safeParse({ status: 'REJECTED', note: 'Missing receipt' })
    expect(result.success).toBe(true)
  })

  it('rejects PENDING (not an allowed transition via org)', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'PENDING' }).success).toBe(false)
  })

  it('rejects unknown status', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'CANCELLED' }).success).toBe(false)
  })

  it('rejects missing status', () => {
    expect(updateInvoiceSchema.safeParse({}).success).toBe(false)
  })

  it('rejects note over 500 chars', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'REJECTED', note: 'x'.repeat(501) }).success).toBe(false)
  })

  it('accepts note of exactly 500 chars', () => {
    expect(updateInvoiceSchema.safeParse({ status: 'APPROVED', note: 'x'.repeat(500) }).success).toBe(true)
  })
})
