// scripts/src/e2e-vault.ts
// ===========================================================================
// E2E FLOW TEST — EmployeeVault split across Navi + Scallop. NOT deployment.
//
// Run AS the employee: the signer must equal the vault owner for every call.
// Assumes packages published (deployed.json filled) + registry configured.
//
// Flow (each step = one Transaction; sequential — create_and_keep returns an
// owned vault whose id later steps need):
//   1. employee_vault::create_and_keep                   -> EmployeeVault (owned)
//   2. employee_vault::init_bucket<T>(token_name)
//   3. employee_vault::deposit_to_bucket<T>(token_name, coin)  (split off funding coin)
//   4. navi lending::create_account -> AccountCap, consumed by
//      navi::store_vault_account_cap (NON-generic) IN THE SAME TX
//   5. navi::vault_invest_navi<T> + scallop::vault_invest_scallop<T>
//   6. navi::vault_withdraw_navi<T> (partial) + scallop::vault_withdraw_scallop<T> (full position)
//
// Dry run by default. --execute (or EXECUTE=1) to submit.
// ===========================================================================

import { Transaction } from '@mysten/sui/transactions'

import {
  CLOCK,
  COIN_TYPE,
  NAVI_ASSET_ID,
  NAVI_INCENTIVE_V2,
  NAVI_INCENTIVE_V3,
  NAVI_LENDING_CORE_PKG,
  NAVI_POOL,
  NAVI_PRICE_ORACLE,
  NAVI_STORAGE,
  SCALLOP_MARKET,
  SCALLOP_VERSION,
  VAULT_DEPOSIT_AMOUNT,
  VAULT_NAVI_AMOUNT,
  VAULT_SCALLOP_AMOUNT,
  VAULT_TOKEN_NAME,
  loadDeployed,
} from './config.ts'
import {
  buildAndMaybeRun,
  createdObjectByType,
  isExecute,
  log,
  ok,
  pickFundingCoin,
  requireId,
  signerAddress,
  warn,
} from './lib.ts'

const T = COIN_TYPE
const TOK = VAULT_TOKEN_NAME

async function main() {
  const d = loadDeployed()
  const corePkg = requireId(d.sweemCorePkg, 'sweemCorePkg')
  const adaptersPkg = requireId(d.sweemAdaptersPkg, 'sweemAdaptersPkg')
  const registry = requireId(d.protocolRegistry, 'protocolRegistry')
  const config = requireId(d.protocolConfig, 'protocolConfig')

  const me = signerAddress()
  log(`vault e2e as owner=${me}, bucket key='${TOK}'`)

  let vaultId = d.vaultId
  const haveCap = !!d.vaultAccountCap

  // ----- Step 1: create vault ----------------------------------------------
  if (!vaultId) {
    const tx1 = new Transaction()
    // entry create_and_keep(ctx) — transfers EmployeeVault to sender
    tx1.moveCall({ target: `${corePkg}::employee_vault::create_and_keep` })
    const r1 = await buildAndMaybeRun(tx1, '1) create_and_keep EmployeeVault')
    if (r1.executed) {
      vaultId = createdObjectByType(r1.response, '::employee_vault::EmployeeVault')
      if (!vaultId) throw new Error('could not parse created EmployeeVault id')
      ok(`VAULT_ID=${vaultId} — paste into deployed.json.vaultId`)
    } else {
      // Valid-format placeholder so dry-run can still build the later step txs.
      vaultId = `0x${'0'.repeat(63)}1`
      warn('dry run: subsequent steps use a placeholder vault id (0x...01).')
    }
  } else {
    log(`reusing vault ${vaultId}`)
  }

  // ----- Step 2: init bucket -----------------------------------------------
  const tx2 = new Transaction()
  // init_bucket<T>(vault, token_name: String, ctx)
  tx2.moveCall({
    target: `${corePkg}::employee_vault::init_bucket`,
    typeArguments: [T],
    arguments: [tx2.object(vaultId!), tx2.pure.string(TOK)],
  })
  const r2 = await buildAndMaybeRun(tx2, `2) init_bucket '${TOK}'`)
  if (r2.executed) ok('bucket opened.')

  // ----- Step 3: deposit into bucket ---------------------------------------
  const coinObj = await pickFundingCoin(VAULT_DEPOSIT_AMOUNT)
  const tx3 = new Transaction()
  const [c] = tx3.splitCoins(tx3.object(coinObj), [tx3.pure.u64(VAULT_DEPOSIT_AMOUNT)])
  // deposit_to_bucket<T>(vault, token_name: String, coin: Coin<T>, ctx)
  tx3.moveCall({
    target: `${corePkg}::employee_vault::deposit_to_bucket`,
    typeArguments: [T],
    arguments: [tx3.object(vaultId!), tx3.pure.string(TOK), c!],
  })
  const r3 = await buildAndMaybeRun(tx3, `3) deposit_to_bucket ${VAULT_DEPOSIT_AMOUNT}`)
  if (r3.executed) ok('bucket funded.')

  // ----- Step 4: Navi AccountCap mint + store (ONE tx, cap consumed) -------
  if (!haveCap) {
    const tx4 = new Transaction()
    const cap = tx4.moveCall({ target: `${NAVI_LENDING_CORE_PKG}::lending::create_account` })
    // store_vault_account_cap(vault, cap, ctx) — NON-generic; consumes the cap
    tx4.moveCall({
      target: `${adaptersPkg}::navi::store_vault_account_cap`,
      arguments: [tx4.object(vaultId!), cap],
    })
    const r4 = await buildAndMaybeRun(tx4, '4) create_account + store_vault_account_cap')
    if (r4.executed) ok('Navi AccountCap stored in vault bucket (not transferred).')
  } else {
    log('reusing stored vault AccountCap')
  }

  // ----- Step 5: invest split (Navi + Scallop) -----------------------------
  const tx5 = new Transaction()
  // vault_invest_navi<T>(vault, token_name, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id, amount, ctx)
  tx5.moveCall({
    target: `${adaptersPkg}::navi::vault_invest_navi`,
    typeArguments: [T],
    arguments: [
      tx5.object(vaultId!),
      tx5.pure.string(TOK),
      tx5.object(NAVI_STORAGE),
      tx5.object(NAVI_POOL),
      tx5.object(NAVI_INCENTIVE_V2),
      tx5.object(NAVI_INCENTIVE_V3),
      tx5.object(registry),
      tx5.object(CLOCK),
      tx5.pure.u8(NAVI_ASSET_ID),
      tx5.pure.u64(VAULT_NAVI_AMOUNT),
    ],
  })
  // vault_invest_scallop<T>(vault, token_name, version, market, registry, clock, amount, ctx)
  tx5.moveCall({
    target: `${adaptersPkg}::scallop::vault_invest_scallop`,
    typeArguments: [T],
    arguments: [
      tx5.object(vaultId!),
      tx5.pure.string(TOK),
      tx5.object(SCALLOP_VERSION),
      tx5.object(SCALLOP_MARKET),
      tx5.object(registry),
      tx5.object(CLOCK),
      tx5.pure.u64(VAULT_SCALLOP_AMOUNT),
    ],
  })
  const r5 = await buildAndMaybeRun(
    tx5,
    `5) vault_invest_navi ${VAULT_NAVI_AMOUNT} + vault_invest_scallop ${VAULT_SCALLOP_AMOUNT}`,
  )
  if (r5.executed) ok('vault invested across Navi + Scallop.')

  // ----- Step 6: withdraw (unwind) from both -------------------------------
  const tx6 = new Transaction()
  // vault_withdraw_navi<T>(vault, token_name, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, amount, ctx)
  tx6.moveCall({
    target: `${adaptersPkg}::navi::vault_withdraw_navi`,
    typeArguments: [T],
    arguments: [
      tx6.object(vaultId!),
      tx6.pure.string(TOK),
      tx6.object(NAVI_STORAGE),
      tx6.object(NAVI_POOL),
      tx6.object(NAVI_INCENTIVE_V2),
      tx6.object(NAVI_INCENTIVE_V3),
      tx6.object(NAVI_PRICE_ORACLE),
      tx6.object(config),
      tx6.object(CLOCK),
      tx6.object(registry),
      tx6.pure.u8(NAVI_ASSET_ID),
      tx6.pure.u64(VAULT_NAVI_AMOUNT),
    ],
  })
  // vault_withdraw_scallop<T>(vault, token_name, version, market, config, registry, clock, ctx)
  // NOTE: no amount arg — redeems the FULL Scallop position.
  tx6.moveCall({
    target: `${adaptersPkg}::scallop::vault_withdraw_scallop`,
    typeArguments: [T],
    arguments: [
      tx6.object(vaultId!),
      tx6.pure.string(TOK),
      tx6.object(SCALLOP_VERSION),
      tx6.object(SCALLOP_MARKET),
      tx6.object(config),
      tx6.object(registry),
      tx6.object(CLOCK),
    ],
  })
  await buildAndMaybeRun(tx6, '6) vault_withdraw_navi (partial) + vault_withdraw_scallop (full)')

  // Optional: pull cash back to wallet —
  //   employee_vault::withdraw_from_bucket<T>(vault, token_name, amount, ctx): Coin<T>
  //   then tx.transferObjects([coin], owner).

  if (!isExecute()) {
    warn('All 6 steps DRY-RUN only. Re-run with --execute to submit (sequentially, in order).')
  } else {
    ok('vault e2e complete.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
