export const ALLOWED_ATTACHMENT_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'] as const
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export type AttachmentExt = (typeof ALLOWED_ATTACHMENT_EXTS)[number]

export function validateAttachment(filename: string, sizeBytes: number): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (!(ALLOWED_ATTACHMENT_EXTS as readonly string[]).includes(ext)) {
    return { ok: false, error: `Unsupported file type: .${ext}` }
  }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'File exceeds 10 MB' }
  }
  return { ok: true, ext }
}

export function attachmentKey(walletAddress: string, uuid: string, ext: string): string {
  return `${walletAddress}/${uuid}.${ext}`
}
