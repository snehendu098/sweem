// scripts/src/lib.ts
// ---------------------------------------------------------------------------
// Shared runtime helpers. NO deploy/publish logic anywhere.
//
//   getClient()           -> SuiJsonRpcClient (same client sweem-server uses)
//   getKeypair()          -> Ed25519Keypair from SUI_PRIVATE_KEY (bech32)
//   isExecute()           -> reads --execute flag / EXECUTE=1 (default: dry run)
//   buildAndMaybeRun()    -> dry run prints serialized tx; execute signs+submits
//   requireId()           -> guard for required string ids
//   pickFundingCoin()     -> largest Coin<COIN_TYPE> owned by the signer (or COIN_OBJECT)
// ---------------------------------------------------------------------------

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { SuiObjectChange, SuiTransactionBlockResponse } from '@mysten/sui/jsonRpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import type { Transaction } from '@mysten/sui/transactions'

import { COIN_OBJECT, COIN_TYPE, NETWORK } from './config.ts'

// ----- logging --------------------------------------------------------------
export const log = (...a: unknown[]) => console.log('\x1b[36m[*]\x1b[0m', ...a)
export const ok = (...a: unknown[]) => console.log('\x1b[32m[ok]\x1b[0m', ...a)
export const warn = (...a: unknown[]) => console.warn('\x1b[33m[!]\x1b[0m', ...a)
export function die(msg: string): never {
  console.error('\x1b[31m[x]\x1b[0m', msg)
  process.exit(1)
}

// ----- client ---------------------------------------------------------------
let _client: SuiJsonRpcClient | null = null
export function getClient(): SuiJsonRpcClient {
  if (!_client) {
    _client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(NETWORK),
      network: NETWORK,
    })
  }
  return _client
}

// ----- keypair --------------------------------------------------------------
let _keypair: Ed25519Keypair | null = null
export function getKeypair(): Ed25519Keypair {
  if (_keypair) return _keypair
  const raw = process.env.SUI_PRIVATE_KEY
  if (!raw || !raw.startsWith('suiprivkey')) {
    die('SUI_PRIVATE_KEY missing or not a bech32 "suiprivkey..." key. See .env.example.')
  }
  // decodeSuiPrivateKey validates the bech32 + scheme; fromSecretKey also accepts
  // the bech32 string directly, but we decode first to fail fast on a bad key.
  const { scheme } = decodeSuiPrivateKey(raw!)
  if (scheme !== 'ED25519') {
    die(`SUI_PRIVATE_KEY scheme is ${scheme}; these scripts expect ED25519.`)
  }
  _keypair = Ed25519Keypair.fromSecretKey(raw!)
  return _keypair
}

export function signerAddress(): string {
  return getKeypair().getPublicKey().toSuiAddress()
}

// ----- execute gating -------------------------------------------------------
export function isExecute(): boolean {
  return process.argv.includes('--execute') || process.env.EXECUTE === '1'
}

// ----- id guard -------------------------------------------------------------
export function requireId(value: string | undefined, name: string): string {
  if (!value || value.length === 0 || value.includes('_FILL')) {
    die(`Required id "${name}" is not set. Fill it in deployed.json / .env.`)
  }
  return value!
}

// ----- build + (maybe) run --------------------------------------------------
export interface RunResult {
  executed: boolean
  response?: SuiTransactionBlockResponse
}

/**
 * Dry run (default): set sender, serialize the tx to JSON, print it, return.
 * Execute (--execute / EXECUTE=1): sign + submit with full effects/objectChanges.
 */
export async function buildAndMaybeRun(
  tx: Transaction,
  label: string,
): Promise<RunResult> {
  const client = getClient()
  const signer = getKeypair()
  tx.setSenderIfNotSet(signer.getPublicKey().toSuiAddress())

  if (!isExecute()) {
    const json = await tx.toJSON()
    log(`DRY RUN — ${label}`)
    console.log(json)
    warn('Not submitted. Re-run with --execute (or EXECUTE=1) to sign + send.')
    return { executed: false }
  }

  log(`EXECUTE — ${label}`)
  const response = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  })
  const status = response.effects?.status?.status
  if (status !== 'success') {
    die(`tx failed: ${response.effects?.status?.error ?? 'unknown error'} (digest ${response.digest})`)
  }
  ok(`submitted ${response.digest}`)
  return { executed: true, response }
}

// Pull the first created object whose objectType matches a substring.
export function createdObjectByType(
  response: SuiTransactionBlockResponse | undefined,
  typeSuffix: string,
): string | undefined {
  const changes: SuiObjectChange[] = response?.objectChanges ?? []
  for (const c of changes) {
    if (c.type === 'created' && c.objectType.includes(typeSuffix)) return c.objectId
  }
  return undefined
}

// ----- funding coin selection ----------------------------------------------
/**
 * In execute mode, returns the funding Coin<COIN_TYPE> object id (COIN_OBJECT
 * override, else the largest owned). In dry-run, returns COIN_OBJECT if set or a
 * documented placeholder so the printed tx is still well-formed.
 */
export async function pickFundingCoin(minRaw: bigint): Promise<string> {
  if (COIN_OBJECT) return COIN_OBJECT

  if (!isExecute()) {
    // Valid-format placeholder so dry-run can build the tx. Set COIN_OBJECT to
    // preview against a real coin, or use --execute to auto-pick the largest.
    warn('dry run: no COIN_OBJECT set — using placeholder funding coin 0x...02.')
    return `0x${'0'.repeat(63)}2`
  }

  const owner = signerAddress()
  const { data } = await getClient().getCoins({ owner, coinType: COIN_TYPE })
  if (data.length === 0) {
    die(`No Coin<${COIN_TYPE}> owned by ${owner}. Set COIN_OBJECT or fund the wallet.`)
  }
  const sorted = [...data].sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1))
  const top = sorted[0]!
  if (BigInt(top.balance) < minRaw) {
    die(`Largest Coin<${COIN_TYPE}> = ${top.balance} raw < required ${minRaw}. Merge coins or fund more.`)
  }
  return top.coinObjectId
}
