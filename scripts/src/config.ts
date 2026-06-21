// scripts/src/config.ts
// ---------------------------------------------------------------------------
// Static constants + env-overridable params + deployed.json loader.
//
// NOTHING here deploys or publishes. The 3 Sweem packages and their shared
// objects (AccessControl<REGISTRY>, ProtocolRegistry, ProtocolConfig) are
// published MANUALLY by the maintainer; their IDs live in scripts/deployed.json
// (gitignored). loadDeployed() reads that file and fails loudly on a missing or
// placeholder id. Protocol-side constants (Navi / Scallop / USDC / Clock) are
// verified mainnet values baked in below; override via env if needed.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = resolve(HERE, '..')

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

// ----- Network --------------------------------------------------------------
export const NETWORK: 'mainnet' | 'testnet' =
  env('SUI_NETWORK') === 'testnet' ? 'testnet' : 'mainnet'

// ----- Coin (mainnet native USDC, 6 decimals) -------------------------------
export const COIN_TYPE =
  env('COIN_TYPE') ??
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export const COIN_DECIMALS = 6
// Navi mainnet enforces a 5 USDC minimum deposit. Any Navi-leg amount must be >= this.
export const NAVI_MIN_DEPOSIT = 5_000_000n // 5 USDC raw

// ----- Sui system objects ---------------------------------------------------
export const CLOCK = '0x6'

// ----- Navi mainnet ---------------------------------------------------------
// latest lending_core package — exposes `lending::create_account` (mints AccountCap).
export const NAVI_LENDING_CORE_PKG =
  env('NAVI_LENDING_CORE_PKG') ??
  '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb'
export const NAVI_STORAGE =
  '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe'
export const NAVI_PRICE_ORACLE =
  '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef'
export const NAVI_INCENTIVE_V2 =
  '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c'
export const NAVI_INCENTIVE_V3 =
  '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
// Pool<COIN_TYPE> + asset_id are coin-specific. Defaults are USDC.
export const NAVI_POOL =
  env('NAVI_POOL') ??
  '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8'
export const NAVI_ASSET_ID = Number(env('NAVI_ASSET_ID') ?? '10')

// ----- Scallop mainnet ------------------------------------------------------
export const SCALLOP_VERSION =
  '0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7'
export const SCALLOP_MARKET =
  '0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9'

// ----- Suilend mainnet ------------------------------------------------------
// LendingMarket<MAIN_POOL> shared object. The adapter resolves the USDC reserve
// index on-chain (reserve_array_index<MAIN_POOL,T>), so no index constant needed.
export const SUILEND_LENDING_MARKET =
  env('SUILEND_LENDING_MARKET') ??
  '0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1'
// Suilend has no Navi-style 5 USDC floor; small amounts ok. Defaults sized for a
// thin (~0.24 USDC) wallet — override via env for a larger run.
export const SUILEND_DEPOSIT_AMOUNT = BigInt(env('SUILEND_DEPOSIT_AMOUNT') ?? '200000') // 0.20 USDC gross
export const SUILEND_INVEST_AMOUNT = BigInt(env('SUILEND_INVEST_AMOUNT') ?? '100000') // 0.10 USDC
export const SUILEND_STREAM_RATE = BigInt(env('SUILEND_STREAM_RATE') ?? '1000') // dust rate / period
// Reuse an existing pool instead of creating a fresh one (org must be the signer).
export const SUILEND_POOL = env('SUILEND_POOL')

// ----- Fees (bps). On-chain caps: deposit <= 500, yield <= 5000. ------------
export const DEPOSIT_FEE_BPS = Number(env('DEPOSIT_FEE_BPS') ?? '25') // 0.25%
export const ORG_YIELD_FEE_BPS = Number(env('ORG_YIELD_FEE_BPS') ?? '1000') // 10%
export const VAULT_YIELD_FEE_BPS = Number(env('VAULT_YIELD_FEE_BPS') ?? '1000') // 10%

// ----- Amounts (raw, 6-decimal USDC). Navi legs default >= 5 USDC floor. -----
export const DEPOSIT_AMOUNT = BigInt(env('DEPOSIT_AMOUNT') ?? '30000000') // 30 USDC gross
export const NAVI_INVEST_AMOUNT = BigInt(env('NAVI_INVEST_AMOUNT') ?? '6000000') // 6 USDC (> 5 min)
export const SCALLOP_INVEST_AMOUNT = BigInt(env('SCALLOP_INVEST_AMOUNT') ?? '5000000')
export const STREAM_RATE_AMOUNT = BigInt(env('STREAM_RATE_AMOUNT') ?? '1000000') // 1 USDC / period
export const STREAM_RATE_PERIOD_MS = BigInt(env('STREAM_RATE_PERIOD_MS') ?? '2592000000') // 30d
export const MIN_COVERAGE_WEEKS = BigInt(env('MIN_COVERAGE_WEEKS') ?? '1')
export const REBAL_AMOUNT = BigInt(env('REBAL_AMOUNT') ?? '5000000') // Navi -> Scallop move

export const VAULT_DEPOSIT_AMOUNT = BigInt(env('VAULT_DEPOSIT_AMOUNT') ?? '12000000') // 12 USDC
export const VAULT_NAVI_AMOUNT = BigInt(env('VAULT_NAVI_AMOUNT') ?? '6000000') // 6 USDC (> 5 min)
export const VAULT_SCALLOP_AMOUNT = BigInt(env('VAULT_SCALLOP_AMOUNT') ?? '5000000')
export const VAULT_TOKEN_NAME = env('VAULT_TOKEN_NAME') ?? 'USDC'

// u64::MAX — used as "redeem the full position" sentinel for Scallop max_amount.
export const U64_MAX = 18446744073709551615n

// ----- Identities (resolved against the signer in lib.ts) -------------------
export const ADMIN_ENV = env('ADMIN')
export const TREASURY_ENV = env('TREASURY')
export const E1_ENV = env('E1')
export const E2_ENV = env('E2')
export const E3_ENV = env('E3')

// Optional pinned funding coin object id.
export const COIN_OBJECT = env('COIN_OBJECT')

// ----- deployed.json (maintainer-filled, gitignored) ------------------------
export interface Deployed {
  sweemRegistryPkg: string
  sweemCorePkg: string
  sweemAdaptersPkg: string
  accessControl: string
  protocolRegistry: string
  protocolConfig: string
  poolId?: string
  poolAccountCap?: string
  vaultId?: string
  vaultAccountCap?: string
}

const DEPLOYED_PATH = resolve(SCRIPTS_DIR, 'deployed.json')
// Canonical, committed mainnet ids (all public on-chain data). Used when the
// gitignored local override deployed.json is absent.
const MAINNET_PATH = resolve(SCRIPTS_DIR, 'deployed.mainnet.json')

let _deployed: Record<string, unknown> | null = null

function rawDeployed(): Record<string, unknown> {
  if (_deployed) return _deployed
  // Prefer the local override (deployed.json); fall back to the committed
  // canonical mainnet file so the scripts work out-of-the-box on mainnet.
  let text: string
  try {
    text = readFileSync(DEPLOYED_PATH, 'utf8')
  } catch {
    try {
      text = readFileSync(MAINNET_PATH, 'utf8')
    } catch {
      throw new Error(
        `Missing ${DEPLOYED_PATH} (and fallback ${MAINNET_PATH}). Deploy the Sweem ` +
          `packages (\`sui client publish\`), then copy deployed.example.json -> deployed.json and fill the IDs.`,
      )
    }
  }
  _deployed = JSON.parse(text) as Record<string, unknown>
  return _deployed
}

function isPlaceholder(v: unknown): boolean {
  return typeof v !== 'string' || v.length === 0 || v.includes('_FILL') || v.includes('OPTIONAL')
}

/** Read deployed.json; the 6 core IDs are required, the created-object IDs are optional. */
export function loadDeployed(): Deployed {
  const d = rawDeployed()
  const required = [
    'sweemRegistryPkg',
    'sweemCorePkg',
    'sweemAdaptersPkg',
    'accessControl',
    'protocolRegistry',
    'protocolConfig',
  ] as const
  for (const k of required) {
    if (isPlaceholder(d[k])) {
      throw new Error(
        `deployed.json: required id "${k}" is missing or still a placeholder. ` +
          `Paste the value from your manual publish.`,
      )
    }
  }
  const opt = (k: string): string | undefined =>
    isPlaceholder(d[k]) ? undefined : (d[k] as string)

  return {
    sweemRegistryPkg: d.sweemRegistryPkg as string,
    sweemCorePkg: d.sweemCorePkg as string,
    sweemAdaptersPkg: d.sweemAdaptersPkg as string,
    accessControl: d.accessControl as string,
    protocolRegistry: d.protocolRegistry as string,
    protocolConfig: d.protocolConfig as string,
    poolId: opt('poolId'),
    poolAccountCap: opt('poolAccountCap'),
    vaultId: opt('vaultId'),
    vaultAccountCap: opt('vaultAccountCap'),
  }
}

export { DEPLOYED_PATH, SCRIPTS_DIR }
