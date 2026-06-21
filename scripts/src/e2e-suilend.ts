// scripts/src/e2e-suilend.ts
// ===========================================================================
// E2E FLOW TEST — Suilend (L) pool round-trip. NOT deployment.
//
// Validates the suilend adapter against the LIVE Suilend mainnet LendingMarket:
// deposit_liquidity_and_mint_ctokens (invest) + redeem_ctokens_and_withdraw_liquidity
// (org_withdraw), incl. the yield-fee path. Receipt-coin model — no AccountCap.
//
// Assumes packages published + upgraded (deployed.json.sweemAdaptersPkg = new id)
// AND `suilend` registered in the registry (add_protocol "suilend" .. 0). Run as
// the pool org (signer).
//
// Flow (each step = one Transaction; sequential):
//   1. stream_pool::create_and_share<T>(min_coverage_weeks)   -> StreamPool (shared)
//      (or reuse SUILEND_POOL)
//   2. stream_pool::deposit<T>: fund 1 dust stream to self
//   3. suilend::pool_invest_suilend<T>(pool, lending_market, registry, clock, amount)
//   4. suilend::org_withdraw_suilend<T>(pool, lending_market, config, registry, clock, amount)
//      large amount → drains the position back to idle (Suilend caps to full position)
//
// Dry run by default. --execute (or EXECUTE=1) to submit.
// ===========================================================================

import { Transaction } from '@mysten/sui/transactions'

import {
  CLOCK,
  COIN_TYPE,
  MIN_COVERAGE_WEEKS,
  STREAM_RATE_PERIOD_MS,
  SUILEND_DEPOSIT_AMOUNT,
  SUILEND_INVEST_AMOUNT,
  SUILEND_LENDING_MARKET,
  SUILEND_POOL,
  SUILEND_STREAM_RATE,
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
// Drain bound for org_withdraw: far above any test position; adapter caps to full position.
const DRAIN = 1_000_000_000n // 1000 USDC raw — capped on-chain to the real position

async function main() {
  const d = loadDeployed()
  const corePkg = requireId(d.sweemCorePkg, 'sweemCorePkg')
  const adaptersPkg = requireId(d.sweemAdaptersPkg, 'sweemAdaptersPkg')
  const registry = requireId(d.protocolRegistry, 'protocolRegistry')
  const config = requireId(d.protocolConfig, 'protocolConfig')
  const lm = requireId(SUILEND_LENDING_MARKET, 'SUILEND_LENDING_MARKET')

  const me = signerAddress()
  log(`suilend e2e as org=${me}`)
  log(`lending_market=${lm} invest=${SUILEND_INVEST_AMOUNT} deposit=${SUILEND_DEPOSIT_AMOUNT}`)

  // ----- Step 1: create + share the pool (or reuse) ------------------------
  let poolId = SUILEND_POOL
  if (!poolId) {
    const tx1 = new Transaction()
    tx1.moveCall({
      target: `${corePkg}::stream_pool::create_and_share`,
      typeArguments: [T],
      arguments: [tx1.pure.u64(MIN_COVERAGE_WEEKS)],
    })
    const r1 = await buildAndMaybeRun(tx1, '1) create_and_share StreamPool')
    if (r1.executed) {
      poolId = createdObjectByType(r1.response, '::stream_pool::StreamPool')
      if (!poolId) throw new Error('could not parse created StreamPool id')
      ok(`POOL_ID=${poolId} — set SUILEND_POOL to reuse on re-runs`)
    } else {
      poolId = `0x${'0'.repeat(63)}1`
      warn('dry run: later steps use a placeholder pool id (0x...01).')
    }
  } else {
    log(`reusing pool ${poolId}`)
  }

  // ----- Step 2: deposit, fund 1 dust stream to self -----------------------
  const coinObj = await pickFundingCoin(SUILEND_DEPOSIT_AMOUNT)
  const tx2 = new Transaction()
  const [pay] = tx2.splitCoins(tx2.object(coinObj), [tx2.pure.u64(SUILEND_DEPOSIT_AMOUNT)])
  // deposit<T>(pool, config, payment, employees, rate_amounts: vector<u128>, rate_periods_ms, clock, ctx)
  tx2.moveCall({
    target: `${corePkg}::stream_pool::deposit`,
    typeArguments: [T],
    arguments: [
      tx2.object(poolId!),
      tx2.object(config),
      pay!,
      tx2.makeMoveVec({ type: 'address', elements: [tx2.pure.address(me)] }),
      tx2.makeMoveVec({ type: 'u128', elements: [tx2.pure.u128(SUILEND_STREAM_RATE)] }),
      tx2.makeMoveVec({ type: 'u64', elements: [tx2.pure.u64(STREAM_RATE_PERIOD_MS)] }),
      tx2.object(CLOCK),
    ],
  })
  const r2 = await buildAndMaybeRun(tx2, `2) deposit ${SUILEND_DEPOSIT_AMOUNT} gross, 1 dust stream`)
  if (r2.executed) ok('stream funded; idle cash available to invest.')

  // ----- Step 3: invest idle cash into Suilend -----------------------------
  const tx3 = new Transaction()
  // pool_invest_suilend<T>(pool, lending_market, registry, clock, amount, ctx)
  tx3.moveCall({
    target: `${adaptersPkg}::suilend::pool_invest_suilend`,
    typeArguments: [T],
    arguments: [
      tx3.object(poolId!),
      tx3.object(lm),
      tx3.object(registry),
      tx3.object(CLOCK),
      tx3.pure.u64(SUILEND_INVEST_AMOUNT),
    ],
  })
  const r3 = await buildAndMaybeRun(tx3, `3) pool_invest_suilend ${SUILEND_INVEST_AMOUNT}`)
  if (r3.executed) ok('invested into Suilend (CToken minted, SuilendInvested emitted).')

  // ----- Step 4: org unwind back to idle (proves redeem + yield-fee path) ---
  const tx4 = new Transaction()
  // org_withdraw_suilend<T>(pool, lending_market, config, registry, clock, amount, ctx)
  tx4.moveCall({
    target: `${adaptersPkg}::suilend::org_withdraw_suilend`,
    typeArguments: [T],
    arguments: [
      tx4.object(poolId!),
      tx4.object(lm),
      tx4.object(config),
      tx4.object(registry),
      tx4.object(CLOCK),
      tx4.pure.u64(DRAIN),
    ],
  })
  await buildAndMaybeRun(tx4, `4) org_withdraw_suilend ${DRAIN} (capped to full position)`)

  if (!isExecute()) {
    warn('All steps DRY-RUN only. Re-run with --execute to submit (sequentially, in order).')
  } else {
    ok('suilend e2e complete — invest + org unwind round-tripped through live Suilend.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
