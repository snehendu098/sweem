// Token registry — single source of truth for every streamable token. Adding a
// new token is one entry here; the tx builders, screens, and icons read from it.

import {
  USDC,
  USDC_DECIMALS,
  SUI,
  SUI_DECIMALS,
  NAVI_POOL_USDC,
  NAVI_ASSET_ID_USDC,
  NAVI_MIN_INVEST_USDC,
  NAVI_POOL_SUI,
  NAVI_ASSET_ID_SUI,
  NAVI_MIN_INVEST_SUI,
} from './sweem'

export type TokenSymbol = 'USDC' | 'SUI'

export interface TokenConfig {
  symbol: TokenSymbol
  coinType: string // full Move type → typeArguments + event filters
  decimals: number
  bucketName: string // employee_vault TokenBucket key
  icon: string // public path to the coin logo
  navi: { poolId: string; assetId: number; minInvest: number } // minInvest in human units
  // Suilend has no per-token on-chain objects (the lending market resolves the
  // reserve), so this is just a UI floor. Absent → suilend not offered for the token.
  suilend?: { minInvest: number }
  // USDY routes via a Cetus USDC<->USDY swap, so it only makes sense for USDC.
  // minInvest is a small UI floor (no on-chain min). Absent → usdy not offered.
  usdy?: { minInvest: number }
}

export const TOKENS: Record<TokenSymbol, TokenConfig> = {
  USDC: {
    symbol: 'USDC',
    coinType: USDC,
    decimals: USDC_DECIMALS,
    bucketName: 'USDC',
    icon: '/tokens/usdc.svg',
    navi: { poolId: NAVI_POOL_USDC, assetId: NAVI_ASSET_ID_USDC, minInvest: NAVI_MIN_INVEST_USDC },
    suilend: { minInvest: 0.1 },
    usdy: { minInvest: 0.1 },
  },
  SUI: {
    symbol: 'SUI',
    coinType: SUI,
    decimals: SUI_DECIMALS,
    bucketName: 'SUI',
    icon: '/tokens/sui.jpg',
    navi: { poolId: NAVI_POOL_SUI, assetId: NAVI_ASSET_ID_SUI, minInvest: NAVI_MIN_INVEST_SUI },
    suilend: { minInvest: 0.01 },
  },
}

export const SUPPORTED_TOKENS: TokenConfig[] = Object.values(TOKENS)
export const TOKEN_SYMBOLS = Object.keys(TOKENS) as TokenSymbol[]

export function tokenBySymbol(symbol: string): TokenConfig | undefined {
  return TOKENS[symbol as TokenSymbol]
}

export function toRaw(token: TokenConfig, amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** token.decimals))
}

export function fromRaw(token: TokenConfig, raw: bigint | string | number): number {
  return Number(BigInt(raw)) / 10 ** token.decimals
}
