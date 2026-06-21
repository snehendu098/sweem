import { describe, it, expect } from 'vitest'
import { validateAttachment, attachmentKey, MAX_ATTACHMENT_BYTES } from './attachment'

describe('validateAttachment', () => {
  it('accepts pdf', () => {
    const r = validateAttachment('receipt.pdf', 1000)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ext).toBe('pdf')
  })

  it('accepts png', () => {
    expect(validateAttachment('photo.png', 500).ok).toBe(true)
  })

  it('accepts jpg', () => {
    expect(validateAttachment('scan.jpg', 500).ok).toBe(true)
  })

  it('accepts jpeg', () => {
    expect(validateAttachment('scan.jpeg', 500).ok).toBe(true)
  })

  it('accepts webp', () => {
    expect(validateAttachment('img.webp', 500).ok).toBe(true)
  })

  it('rejects exe', () => {
    const r = validateAttachment('malware.exe', 100)
    expect(r.ok).toBe(false)
  })

  it('rejects txt', () => {
    expect(validateAttachment('notes.txt', 100).ok).toBe(false)
  })

  it('rejects file with no extension', () => {
    expect(validateAttachment('nodotfile', 100).ok).toBe(false)
  })

  it('rejects file at exactly MAX + 1 byte', () => {
    const r = validateAttachment('big.pdf', MAX_ATTACHMENT_BYTES + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/10 MB/)
  })

  it('accepts file at exactly MAX bytes', () => {
    expect(validateAttachment('big.pdf', MAX_ATTACHMENT_BYTES).ok).toBe(true)
  })

  it('is case-insensitive for extension', () => {
    expect(validateAttachment('RECEIPT.PDF', 1000).ok).toBe(true)
    expect(validateAttachment('photo.PNG', 1000).ok).toBe(true)
  })

  it('handles dotfile names (.pdf)', () => {
    const r = validateAttachment('.pdf', 100)
    expect(r.ok).toBe(true)
  })

  it('handles multi-dot filenames', () => {
    const r = validateAttachment('my.expense.report.pdf', 100)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ext).toBe('pdf')
  })
})

describe('attachmentKey', () => {
  it('formats as wallet/uuid.ext', () => {
    const key = attachmentKey('0xabc', 'uuid-123', 'pdf')
    expect(key).toBe('0xabc/uuid-123.pdf')
  })

  it('wallet address is preserved as-is', () => {
    const key = attachmentKey('0xDEADBEEF', 'id', 'png')
    expect(key.startsWith('0xDEADBEEF/')).toBe(true)
  })
})
