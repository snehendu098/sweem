import type { SuiClient } from './sui'

// Server-side token registry — mirrors fe/lib/tokens.ts. Used to verify on-chain
// invoice payments (coin type + decimals) by transaction digest.
export const SERVER_TOKENS: Record<string, { coinType: string; decimals: number }> = {
  USDC: {
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    decimals: 6,
  },
  SUI: {
    coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    decimals: 9,
  },
}

// Normalize a Sui coin type so 0x2::sui::SUI === 0x000…0002::sui::SUI. Pads the
// address segment to 64 hex chars; lowercases module + struct tails.
export function normalizeCoinType(coinType: string): string {
  const [addr, ...rest] = coinType.split('::')
  const hex = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  return `0x${hex}::${rest.join('::').toLowerCase()}`
}

export function toRawAmount(amount: number | string, decimals: number): bigint {
  // amount is a human-readable numeric (possibly fractional) — convert to base units.
  const [whole, frac = ''] = String(amount).split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}

export interface PaymentCheck {
  ok: boolean
  error?: string
}

// Verify a transaction actually paid an invoice: it succeeded, was sent by the org,
// and credited the employee at least `amount` of `tokenSymbol`.
export async function verifyInvoicePayment(
  client: SuiClient,
  digest: string,
  opts: { sender: string; recipient: string; tokenSymbol: string; amount: number | string },
): Promise<PaymentCheck> {
  const token = SERVER_TOKENS[opts.tokenSymbol]
  if (!token) return { ok: false, error: `Unknown token: ${opts.tokenSymbol}` }

  let tx
  try {
    tx = await client.getTransactionBlock({
      digest,
      options: { showEffects: true, showBalanceChanges: true, showInput: true },
    })
  } catch {
    return { ok: false, error: 'Transaction not found' }
  }

  if (tx.effects?.status?.status !== 'success') {
    return { ok: false, error: 'Transaction did not succeed' }
  }

  const sender = tx.transaction?.data?.sender
  if (sender && sender.toLowerCase() !== opts.sender.toLowerCase()) {
    return { ok: false, error: 'Transaction sender is not the organisation' }
  }

  const wantType = normalizeCoinType(token.coinType)
  const minRaw = toRawAmount(opts.amount, token.decimals)
  const recipient = opts.recipient.toLowerCase()

  const credited = (tx.balanceChanges ?? []).find((bc) => {
    const owner = bc.owner as { AddressOwner?: string } | string
    const ownerAddr = typeof owner === 'object' && owner?.AddressOwner ? owner.AddressOwner : ''
    return (
      ownerAddr.toLowerCase() === recipient &&
      normalizeCoinType(bc.coinType) === wantType &&
      BigInt(bc.amount) >= minRaw
    )
  })

  if (!credited) {
    return { ok: false, error: 'Transaction did not pay the employee the invoice amount' }
  }

  return { ok: true }
}
