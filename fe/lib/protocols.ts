// Yield-protocol registry — the single source of truth the screens map over so
// they stop hardcoding per-protocol state (naviYes/scallopYes/…). Adding a
// protocol is one entry here plus its tx builder.
//
// Scope rule (also enforced on-chain): the org payroll POOL may hold L/Y only
// (navi, scallop, suilend, usdy) — never an LST. VAULTS may hold L/Y/S (all five,
// incl. stSUI). stSUI is SUI-only; USDY routes through a USDC<->USDY swap so it is
// USDC-only.

import type { TokenConfig, TokenSymbol } from './tokens'

export type YieldType = 'L' | 'Y' | 'S'
export type ProtocolKey = 'navi' | 'scallop' | 'suilend' | 'usdy' | 'stsui'
export type Scope = 'pool' | 'vault'

// Server `/v1/compute/yields` quote key for this protocol's live APY.
export type ApyEnum = 'NAVI' | 'SCALLOP' | 'SUILEND' | 'USDY' | 'STSUI'

export interface ProtocolDescriptor {
  key: ProtocolKey
  label: string
  yieldType: YieldType
  scopes: Scope[]
  apyEnum: ApyEnum
  tokens?: TokenSymbol[] // restrict to these symbols; undefined = any supported token
  async: boolean // true ⇒ invest/withdraw build a PTB asynchronously (Cetus swap)
}

export const PROTOCOLS: Record<ProtocolKey, ProtocolDescriptor> = {
  navi: { key: 'navi', label: 'Navi', yieldType: 'L', scopes: ['pool', 'vault'], apyEnum: 'NAVI', async: false },
  scallop: { key: 'scallop', label: 'Scallop', yieldType: 'L', scopes: ['pool', 'vault'], apyEnum: 'SCALLOP', async: false },
  suilend: { key: 'suilend', label: 'Suilend', yieldType: 'L', scopes: ['pool', 'vault'], apyEnum: 'SUILEND', async: false },
  usdy: { key: 'usdy', label: 'Ondo USDY', yieldType: 'Y', scopes: ['pool', 'vault'], apyEnum: 'USDY', tokens: ['USDC'], async: true },
  stsui: { key: 'stsui', label: 'stSUI', yieldType: 'S', scopes: ['vault'], apyEnum: 'STSUI', tokens: ['SUI'], async: false },
}

export const ALL_PROTOCOLS: ProtocolDescriptor[] = Object.values(PROTOCOLS)

// True when this protocol is offered for `token` (per-token config gates suilend/usdy;
// stSUI is SUI-fixed). navi/scallop are offered for every supported token.
function tokenSupports(p: ProtocolDescriptor, token: TokenConfig): boolean {
  if (p.tokens && !p.tokens.includes(token.symbol)) return false
  if (p.key === 'suilend') return token.suilend !== undefined
  if (p.key === 'usdy') return token.usdy !== undefined
  return true
}

// Protocols available in a given scope for a given token, in display order.
export function protocolsForScope(scope: Scope, token: TokenConfig): ProtocolDescriptor[] {
  return ALL_PROTOCOLS.filter((p) => p.scopes.includes(scope) && tokenSupports(p, token))
}

// Per-protocol UI invest floor (human units). navi/suilend carry real/UI mins;
// usdy/stsui/scallop have none (0).
export function minInvestFor(key: ProtocolKey, token: TokenConfig): number {
  if (key === 'navi') return token.navi.minInvest
  if (key === 'suilend') return token.suilend?.minInvest ?? 0
  if (key === 'usdy') return token.usdy?.minInvest ?? 0
  return 0
}
