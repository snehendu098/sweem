import { describe, it, expect } from 'vitest'
import { normalizeCoinType, toRawAmount, verifyInvoicePayment, SERVER_TOKENS } from './payment'
import type { SuiClient } from './sui'

describe('normalizeCoinType', () => {
  it('pads SUI short form to 64-hex address', () => {
    expect(normalizeCoinType('0x2::sui::SUI')).toBe('0x' + '0'.repeat(63) + '2::sui::sui')
  })

  it('treats 0x2 and full-length form as equal', () => {
    expect(normalizeCoinType('0x2::sui::SUI')).toBe(normalizeCoinType(SERVER_TOKENS.SUI.coinType))
  })

  it('lowercases module + struct', () => {
    expect(normalizeCoinType('0x2::SUI::Sui')).toBe('0x' + '0'.repeat(63) + '2::sui::sui')
  })
})

describe('toRawAmount', () => {
  it('USDC 0.2 → 200000 (6dp)', () => {
    expect(toRawAmount(0.2, 6)).toBe(200000n)
  })

  it('USDC 100 → 100000000', () => {
    expect(toRawAmount(100, 6)).toBe(100_000_000n)
  })

  it('SUI 1.5 → 1.5e9', () => {
    expect(toRawAmount(1.5, 9)).toBe(1_500_000_000n)
  })

  it('truncates excess fractional digits', () => {
    expect(toRawAmount('0.1234567', 6)).toBe(123456n)
  })

  it('handles integer string', () => {
    expect(toRawAmount('5', 6)).toBe(5_000_000n)
  })
})

// Minimal fake matching the bits verifyInvoicePayment reads.
function fakeClient(resp: unknown): SuiClient {
  return { getTransactionBlock: async () => resp } as unknown as SuiClient
}

const ORG = '0xORG'
const EMP = '0xEMP'

function okResp(over: Record<string, unknown> = {}) {
  return {
    effects: { status: { status: 'success' } },
    transaction: { data: { sender: ORG } },
    balanceChanges: [
      { owner: { AddressOwner: ORG }, coinType: SERVER_TOKENS.USDC.coinType, amount: '-200000' },
      { owner: { AddressOwner: EMP }, coinType: SERVER_TOKENS.USDC.coinType, amount: '200000' },
    ],
    ...over,
  }
}

const base = { sender: ORG, recipient: EMP, tokenSymbol: 'USDC', amount: 0.2 }

describe('verifyInvoicePayment', () => {
  it('passes when employee credited exact amount', async () => {
    const r = await verifyInvoicePayment(fakeClient(okResp()), '0xd', base)
    expect(r.ok).toBe(true)
  })

  it('passes when credited more than invoice amount', async () => {
    const r = await verifyInvoicePayment(fakeClient(okResp()), '0xd', { ...base, amount: 0.1 })
    expect(r.ok).toBe(true)
  })

  it('fails on unknown token', async () => {
    const r = await verifyInvoicePayment(fakeClient(okResp()), '0xd', { ...base, tokenSymbol: 'DOGE' })
    expect(r.ok).toBe(false)
  })

  it('fails when tx not found', async () => {
    const client = { getTransactionBlock: async () => { throw new Error('not found') } } as unknown as SuiClient
    const r = await verifyInvoicePayment(client, '0xd', base)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found/i)
  })

  it('fails when tx failed', async () => {
    const r = await verifyInvoicePayment(fakeClient(okResp({ effects: { status: { status: 'failure' } } })), '0xd', base)
    expect(r.ok).toBe(false)
  })

  it('fails when sender is not the org', async () => {
    const r = await verifyInvoicePayment(fakeClient(okResp({ transaction: { data: { sender: '0xOTHER' } } })), '0xd', base)
    expect(r.ok).toBe(false)
  })

  it('fails when employee credited less than amount', async () => {
    const resp = okResp({
      balanceChanges: [{ owner: { AddressOwner: EMP }, coinType: SERVER_TOKENS.USDC.coinType, amount: '199999' }],
    })
    const r = await verifyInvoicePayment(fakeClient(resp), '0xd', base)
    expect(r.ok).toBe(false)
  })

  it('fails when wrong token credited', async () => {
    const resp = okResp({
      balanceChanges: [{ owner: { AddressOwner: EMP }, coinType: SERVER_TOKENS.SUI.coinType, amount: '200000' }],
    })
    const r = await verifyInvoicePayment(fakeClient(resp), '0xd', base)
    expect(r.ok).toBe(false)
  })

  it('matches recipient case-insensitively + SUI short coin form', async () => {
    const resp = okResp({
      transaction: { data: { sender: ORG.toLowerCase() } },
      balanceChanges: [{ owner: { AddressOwner: EMP.toUpperCase() }, coinType: '0x2::sui::SUI', amount: '1500000000' }],
    })
    const r = await verifyInvoicePayment(fakeClient(resp), '0xd', { ...base, tokenSymbol: 'SUI', amount: 1.5 })
    expect(r.ok).toBe(true)
  })
})
