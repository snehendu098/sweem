// scripts/src/e2e-split-pool.ts
// ===========================================================================
// E2E FLOW TEST — pool SPLIT across Navi + Scallop. NOT deployment.
//
// Assumes packages are published (deployed.json filled) AND the registry is
// configured (admin-setup, or done by hand). Run org-side steps (signer = pool
// org). Step 5's employee claim uses ctx.sender(), so to test multi-party run
// it with the employee's key; with a single key (E1 = signer) it just works.
//
// Flow (each step = one Transaction; sequential because create_and_share shares
// the pool and later steps need its id):
//   1. stream_pool::create_and_share<T>(min_coverage_weeks=1)   -> StreamPool (shared)
//   2. navi lending::create_account -> AccountCap, consumed by
//      navi::store_pool_account_cap<T> IN THE SAME TX (cap never transferred)
//   3. stream_pool::deposit<T>: fund 3 streams (>=5 USDC each leg respected at pool level)
//   4. navi::pool_invest_navi<T> + scallop::pool_invest_scallop<T> (leave some idle)
//   5. EMPLOYEE SPLIT CLAIM as ONE Transaction:
//        navi::cover_claim_from_navi<T> + scallop::cover_claim_from_scallop<T>
//        + stream_pool::claim<T> -> Coin<T>, transfer to sender
//   6. ORG REBALANCE as ONE Transaction:
//        navi::org_withdraw_navi<T> then scallop::pool_invest_scallop<T>
//
// Dry run by default. --execute (or EXECUTE=1) to submit.
//
// NOTE: claim has a min-claim gate (10% of a week's earnings). With dust rates a
// brand-new stream is not claimable immediately — let accrual pass before step 5.
// ===========================================================================

import { Transaction } from '@mysten/sui/transactions'

import {
  CLOCK,
  COIN_TYPE,
  DEPOSIT_AMOUNT,
  E1_ENV,
  E2_ENV,
  E3_ENV,
  MIN_COVERAGE_WEEKS,
  NAVI_ASSET_ID,
  NAVI_INCENTIVE_V2,
  NAVI_INCENTIVE_V3,
  NAVI_INVEST_AMOUNT,
  NAVI_LENDING_CORE_PKG,
  NAVI_POOL,
  NAVI_PRICE_ORACLE,
  NAVI_STORAGE,
  REBAL_AMOUNT,
  SCALLOP_INVEST_AMOUNT,
  SCALLOP_MARKET,
  SCALLOP_VERSION,
  STREAM_RATE_AMOUNT,
  STREAM_RATE_PERIOD_MS,
  U64_MAX,
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

const T = COIN_TYPE // <T> type-arg on every generic call

async function main() {
  const d = loadDeployed()
  const corePkg = requireId(d.sweemCorePkg, 'sweemCorePkg')
  const adaptersPkg = requireId(d.sweemAdaptersPkg, 'sweemAdaptersPkg')
  const registry = requireId(d.protocolRegistry, 'protocolRegistry')
  const config = requireId(d.protocolConfig, 'protocolConfig')

  const me = signerAddress()
  const e1 = E1_ENV ?? me
  const e2 = E2_ENV ?? me
  const e3 = E3_ENV ?? me

  // Allow reusing an already-created pool/cap (from a prior run) via deployed.json.
  let poolId = d.poolId
  const haveCap = !!d.poolAccountCap

  log(`split-pool e2e as org=${me}, employees=[${e1}, ${e2}, ${e3}]`)

  // ----- Step 1: create + share the pool -----------------------------------
  if (!poolId) {
    const tx1 = new Transaction()
    // entry create_and_share<T>(min_coverage_weeks: u64)
    tx1.moveCall({
      target: `${corePkg}::stream_pool::create_and_share`,
      typeArguments: [T],
      arguments: [tx1.pure.u64(MIN_COVERAGE_WEEKS)],
    })
    const r1 = await buildAndMaybeRun(tx1, '1) create_and_share StreamPool')
    if (r1.executed) {
      poolId = createdObjectByType(r1.response, '::stream_pool::StreamPool')
      if (!poolId) throw new Error('could not parse created StreamPool id')
      ok(`POOL_ID=${poolId} — paste into deployed.json.poolId`)
    } else {
      // Valid-format placeholder so dry-run can still build the later step txs.
      poolId = `0x${'0'.repeat(63)}1`
      warn('dry run: subsequent steps use a placeholder pool id (0x...01).')
    }
  } else {
    log(`reusing pool ${poolId}`)
  }

  // ----- Step 2: Navi AccountCap mint + store (ONE tx, cap consumed) --------
  if (!haveCap) {
    const tx2 = new Transaction()
    // <naviPkg>::lending::create_account(ctx): AccountCap  (returns owned object)
    const cap = tx2.moveCall({
      target: `${NAVI_LENDING_CORE_PKG}::lending::create_account`,
    })
    // navi::store_pool_account_cap<T>(pool, cap, ctx) — consumes the cap into the pool DOF
    tx2.moveCall({
      target: `${adaptersPkg}::navi::store_pool_account_cap`,
      typeArguments: [T],
      arguments: [tx2.object(poolId!), cap],
    })
    const r2 = await buildAndMaybeRun(tx2, '2) create_account + store_pool_account_cap')
    if (r2.executed) ok('Navi AccountCap stored in pool (not transferred).')
  } else {
    log('reusing stored pool AccountCap')
  }

  // ----- Step 3: deposit, fund 3 streams -----------------------------------
  const coinObj = await pickFundingCoin(DEPOSIT_AMOUNT)
  const tx3 = new Transaction()
  // split the exact deposit off the funding coin (do NOT consume the whole coin)
  const [pay] = tx3.splitCoins(tx3.object(coinObj), [tx3.pure.u64(DEPOSIT_AMOUNT)])
  // deposit<T>(pool, config, payment: Coin<T>, employees: vector<address>,
  //            rate_amounts: vector<u128>, rate_periods_ms: vector<u64>, clock, ctx)
  tx3.moveCall({
    target: `${corePkg}::stream_pool::deposit`,
    typeArguments: [T],
    arguments: [
      tx3.object(poolId!),
      tx3.object(config),
      pay!,
      tx3.makeMoveVec({
        type: 'address',
        elements: [tx3.pure.address(e1), tx3.pure.address(e2), tx3.pure.address(e3)],
      }),
      tx3.makeMoveVec({
        type: 'u128',
        elements: [
          tx3.pure.u128(STREAM_RATE_AMOUNT),
          tx3.pure.u128(STREAM_RATE_AMOUNT),
          tx3.pure.u128(STREAM_RATE_AMOUNT),
        ],
      }),
      tx3.makeMoveVec({
        type: 'u64',
        elements: [
          tx3.pure.u64(STREAM_RATE_PERIOD_MS),
          tx3.pure.u64(STREAM_RATE_PERIOD_MS),
          tx3.pure.u64(STREAM_RATE_PERIOD_MS),
        ],
      }),
      tx3.object(CLOCK),
    ],
  })
  const r3 = await buildAndMaybeRun(tx3, `3) deposit ${DEPOSIT_AMOUNT} gross, 3 streams`)
  if (r3.executed) ok('streams created for E1,E2,E3.')

  // ----- Step 4: split invest (Navi + Scallop), leave idle -----------------
  const tx4 = new Transaction()
  // pool_invest_navi<T>(pool, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id, amount, ctx)
  tx4.moveCall({
    target: `${adaptersPkg}::navi::pool_invest_navi`,
    typeArguments: [T],
    arguments: [
      tx4.object(poolId!),
      tx4.object(NAVI_STORAGE),
      tx4.object(NAVI_POOL),
      tx4.object(NAVI_INCENTIVE_V2),
      tx4.object(NAVI_INCENTIVE_V3),
      tx4.object(registry),
      tx4.object(CLOCK),
      tx4.pure.u8(NAVI_ASSET_ID),
      tx4.pure.u64(NAVI_INVEST_AMOUNT),
    ],
  })
  // pool_invest_scallop<T>(pool, version, market, registry, clock, amount, ctx)
  tx4.moveCall({
    target: `${adaptersPkg}::scallop::pool_invest_scallop`,
    typeArguments: [T],
    arguments: [
      tx4.object(poolId!),
      tx4.object(SCALLOP_VERSION),
      tx4.object(SCALLOP_MARKET),
      tx4.object(registry),
      tx4.object(CLOCK),
      tx4.pure.u64(SCALLOP_INVEST_AMOUNT),
    ],
  })
  const r4 = await buildAndMaybeRun(
    tx4,
    `4) pool_invest_navi ${NAVI_INVEST_AMOUNT} + pool_invest_scallop ${SCALLOP_INVEST_AMOUNT}`,
  )
  if (r4.executed) ok('invested across Navi + Scallop (rest idle).')

  // ----- Step 5: EMPLOYEE SPLIT CLAIM (ONE tx) -----------------------------
  // Run with the employee key for a real multi-party test (claim uses ctx.sender).
  // cover_* recompute the caller's own shortfall, so chaining composes; the final
  // stream_pool::claim is the single assertion point.
  const tx5 = new Transaction()
  // cover_claim_from_navi<T>(pool, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, max_amount, ctx)
  // Pass the Navi invested amount as a safe upper bound; cover_* bounds to real shortfall.
  tx5.moveCall({
    target: `${adaptersPkg}::navi::cover_claim_from_navi`,
    typeArguments: [T],
    arguments: [
      tx5.object(poolId!),
      tx5.object(NAVI_STORAGE),
      tx5.object(NAVI_POOL),
      tx5.object(NAVI_INCENTIVE_V2),
      tx5.object(NAVI_INCENTIVE_V3),
      tx5.object(NAVI_PRICE_ORACLE),
      tx5.object(config),
      tx5.object(CLOCK),
      tx5.object(registry),
      tx5.pure.u8(NAVI_ASSET_ID),
      tx5.pure.u64(NAVI_INVEST_AMOUNT),
    ],
  })
  // cover_claim_from_scallop<T>(pool, version, market, config, registry, clock, max_amount, ctx)
  // u64::MAX max_amount: Scallop self-caps redemption to the full position.
  tx5.moveCall({
    target: `${adaptersPkg}::scallop::cover_claim_from_scallop`,
    typeArguments: [T],
    arguments: [
      tx5.object(poolId!),
      tx5.object(SCALLOP_VERSION),
      tx5.object(SCALLOP_MARKET),
      tx5.object(config),
      tx5.object(registry),
      tx5.object(CLOCK),
      tx5.pure.u64(U64_MAX),
    ],
  })
  // claim<T>(pool, clock, ctx): Coin<T> -> transfer to the claiming employee (sender)
  const [claimed] = [
    tx5.moveCall({
      target: `${corePkg}::stream_pool::claim`,
      typeArguments: [T],
      arguments: [tx5.object(poolId!), tx5.object(CLOCK)],
    }),
  ]
  tx5.transferObjects([claimed!], tx5.pure.address(signerAddress()))
  await buildAndMaybeRun(tx5, '5) employee split claim (cover navi + cover scallop + claim)')

  // ----- ALTERNATIVE: single-protocol one-shot claim ------------------------
  // If the pool is invested in ONLY Navi, replace step 5 with:
  //   claim_liquidity::claim_with_liquidity<T>(pool, storage, navi_pool, inc_v2,
  //     inc_v3, oracle, registry, config, clock, asset_id, ctx): Coin<T>
  // If invested ONLY in Scallop:
  //   claim_liquidity_scallop::claim_with_liquidity_scallop<T>(pool, version,
  //     market, registry, config, clock, ctx): Coin<T>
  // Both return a Coin<T> to transfer to the employee (sender).

  // ----- Step 6: ORG REBALANCE Navi -> Scallop (ONE tx) --------------------
  const tx6 = new Transaction()
  // org_withdraw_navi<T>(pool, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, amount, ctx)
  tx6.moveCall({
    target: `${adaptersPkg}::navi::org_withdraw_navi`,
    typeArguments: [T],
    arguments: [
      tx6.object(poolId!),
      tx6.object(NAVI_STORAGE),
      tx6.object(NAVI_POOL),
      tx6.object(NAVI_INCENTIVE_V2),
      tx6.object(NAVI_INCENTIVE_V3),
      tx6.object(NAVI_PRICE_ORACLE),
      tx6.object(config),
      tx6.object(CLOCK),
      tx6.object(registry),
      tx6.pure.u8(NAVI_ASSET_ID),
      tx6.pure.u64(REBAL_AMOUNT),
    ],
  })
  // then re-invest the freed idle cash into Scallop
  tx6.moveCall({
    target: `${adaptersPkg}::scallop::pool_invest_scallop`,
    typeArguments: [T],
    arguments: [
      tx6.object(poolId!),
      tx6.object(SCALLOP_VERSION),
      tx6.object(SCALLOP_MARKET),
      tx6.object(registry),
      tx6.object(CLOCK),
      tx6.pure.u64(REBAL_AMOUNT),
    ],
  })
  await buildAndMaybeRun(tx6, `6) org rebalance org_withdraw_navi -> pool_invest_scallop (${REBAL_AMOUNT})`)

  if (!isExecute()) {
    warn('All 6 steps DRY-RUN only. Re-run with --execute to submit (sequentially, in order).')
  } else {
    ok('split-pool e2e complete.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
