import { verifyPersonalMessageSignature } from '@mysten/sui/verify'

const MESSAGE_TTL_MS = 60_000

export async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const parts = message.split(':')
  if (parts.length !== 4 || parts[0] !== 'sweem') return false

  const timestamp = parseInt(parts[3], 10)
  if (isNaN(timestamp)) return false
  if (Date.now() - timestamp * 1000 > MESSAGE_TTL_MS) return false

  try {
    const publicKey = await verifyPersonalMessageSignature(
      new TextEncoder().encode(message),
      signature,
    )
    return publicKey.toSuiAddress() === walletAddress
  } catch {
    return false
  }
}
