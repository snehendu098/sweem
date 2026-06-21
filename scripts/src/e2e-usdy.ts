// scripts/src/e2e-usdy.ts
// ===========================================================================
// E2E FLOW TEST — Ondo USDY (Y) pool round-trip. NOT deployment.
//
// Validates the usdy adapter against LIVE mainnet + the Cetus aggregator. The
// USDC<->USDY swap is OFF-chain (built into the PTB via @cetusprotocol/aggregator-sdk),
// made atomic with the on-chain extract/deposit by a no-abilities hot-potato receipt:
//   invest:  pool_invest_usdy_extract<T> -> Coin<T> -> [Cetus swap] -> Coin<Y>
//            -> pool_invest_usdy_deposit<T,Y>            (ALL one Transaction)
//   withdraw: pool_withdraw_usdy_extract<T,Y> -> Coin<Y> -> [Cetus swap] -> Coin<T>
//            -> pool_withdraw_usdy_deposit<T>            (ALL one Transaction)
//
// Assumes packages published + `usdy` registered in the registry. Run as the pool org.
// The USDY/USDC Cetus pool is THIN — keep amounts tiny and always honor min_out
// (enforced on-chain by routerSwap's slippage).
//
// Dry run by default. --execute (or EXECUTE=1) to submit.
// Env: USDY_POOL (reuse), USDY_INVEST_AMOUNT (USDC raw), USDY_WITHDRAW_Y (USDY raw),
//      USDY_SLIPPAGE_BPS (default 100 = 1%).
// ===========================================================================

import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk'

import {
  CLOCK,
  COIN_TYPE,
  MIN_COVERAGE_WEEKS,
  STREAM_RATE_PERIOD_MS,
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
const USDY_TYPE = '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY'

const env = (k: string) => process.env[k]
const DEPOSIT_AMOUNT = BigInt(env('USDY_DEPOSIT_AMOUNT') ?? '300000') // 0.3 USDC gross
const INVEST_AMOUNT = BigInt(env('USDY_INVEST_AMOUNT') ?? '100000') // 0.1 USDC → USDY
const WITHDRAW_Y = BigInt(env('USDY_WITHDRAW_Y') ?? '50000') // 0.05 USDY → USDC (≤ held)
const SLIPPAGE_BPS = Number(env('USDY_SLIPPAGE_BPS') ?? '100') // 1%
const STREAM_RATE = BigInt(env('STREAM_RATE_AMOUNT') ?? '1000000')

// Append a Cetus swap onto `tx`, consuming `inputCoin`, returning the output coin.
async function appendCetusSwap(
  tx: Transaction,
  args: { inputCoin: TransactionObjectArgument; fromType: string; toType: string; amountIn: bigint },
): Promise<TransactionObjectArgument> {
  const client = new AggregatorClient({ env: Env.Mainnet })
  const router = await client.findRouters({
    from: args.fromType,
    target: args.toType,
    amount: args.amountIn,
    byAmountIn: true,
  })
  if (!router) throw new Error(`no Cetus route ${args.fromType} -> ${args.toType}`)
  return client.routerSwap({ router, txb: tx, inputCoin: args.inputCoin, slippage: SLIPPAGE_BPS / 10_000 })
}

async function main() {
  const d = loadDeployed()
  const corePkg = requireId(d.sweemCorePkg, 'sweemCorePkg')
  const adaptersPkg = requireId(d.sweemAdaptersPkg, 'sweemAdaptersPkg')
  const registry = requireId(d.protocolRegistry, 'protocolRegistry')
  const config = requireId(d.protocolConfig, 'protocolConfig')

  const me = signerAddress()
  log(`usdy e2e as org=${me}`)
  log(`invest=${INVEST_AMOUNT} (USDC->USDY) withdraw_y=${WITHDRAW_Y} (USDY->USDC) slippage=${SLIPPAGE_BPS}bps`)

  // ----- Step 1: create + share the pool (or reuse) ------------------------
  let poolId = env('USDY_POOL')
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
      ok(`POOL_ID=${poolId} — set USDY_POOL to reuse on re-runs`)
    } else {
      poolId = `0x${'0'.repeat(63)}1`
      warn('dry run: later steps use a placeholder pool id (0x...01).')
    }
  } else {
    log(`reusing pool ${poolId}`)
  }

  // ----- Step 2: deposit, fund 1 dust stream to self -----------------------
  const coinObj = await pickFundingCoin(DEPOSIT_AMOUNT)
  const tx2 = new Transaction()
  const [pay] = tx2.splitCoins(tx2.object(coinObj), [tx2.pure.u64(DEPOSIT_AMOUNT)])
  tx2.moveCall({
    target: `${corePkg}::stream_pool::deposit`,
    typeArguments: [T],
    arguments: [
      tx2.object(poolId!),
      tx2.object(config),
      pay!,
      tx2.makeMoveVec({ type: 'address', elements: [tx2.pure.address(me)] }),
      tx2.makeMoveVec({ type: 'u128', elements: [tx2.pure.u128(STREAM_RATE)] }),
      tx2.makeMoveVec({ type: 'u64', elements: [tx2.pure.u64(STREAM_RATE_PERIOD_MS)] }),
      tx2.object(CLOCK),
    ],
  })
  const r2 = await buildAndMaybeRun(tx2, `2) deposit ${DEPOSIT_AMOUNT} gross, 1 dust stream`)
  if (r2.executed) ok('stream funded; idle cash available to invest.')

  // ----- Step 3: invest idle USDC into USDY (extract -> Cetus swap -> deposit) ---
  const tx3 = new Transaction()
  const [usdcCoin, investReceipt] = tx3.moveCall({
    target: `${adaptersPkg}::usdy::pool_invest_usdy_extract`,
    typeArguments: [T],
    arguments: [tx3.object(poolId!), tx3.object(registry), tx3.pure.u64(INVEST_AMOUNT)],
  })
  const usdyCoin = await appendCetusSwap(tx3, {
    inputCoin: usdcCoin!,
    fromType: T,
    toType: USDY_TYPE,
    amountIn: INVEST_AMOUNT,
  })
  tx3.moveCall({
    target: `${adaptersPkg}::usdy::pool_invest_usdy_deposit`,
    typeArguments: [T, USDY_TYPE],
    arguments: [tx3.object(poolId!), tx3.object(registry), usdyCoin, investReceipt!],
  })
  const r3 = await buildAndMaybeRun(tx3, `3) pool_invest_usdy ${INVEST_AMOUNT} (extract->swap->deposit)`)
  if (r3.executed) ok('invested into USDY (UsdyInvested emitted; Coin<Y> custodied).')

  // ----- Step 4: unwind USDY back to idle USDC (extract -> Cetus swap -> deposit) ---
  const tx4 = new Transaction()
  const [usdyOut, withdrawReceipt] = tx4.moveCall({
    target: `${adaptersPkg}::usdy::pool_withdraw_usdy_extract`,
    typeArguments: [T, USDY_TYPE],
    arguments: [tx4.object(poolId!), tx4.object(registry), tx4.pure.u64(WITHDRAW_Y)],
  })
  const usdcBack = await appendCetusSwap(tx4, {
    inputCoin: usdyOut!,
    fromType: USDY_TYPE,
    toType: T,
    amountIn: WITHDRAW_Y,
  })
  tx4.moveCall({
    target: `${adaptersPkg}::usdy::pool_withdraw_usdy_deposit`,
    typeArguments: [T],
    arguments: [tx4.object(poolId!), tx4.object(config), tx4.object(registry), usdcBack, withdrawReceipt!],
  })
  await buildAndMaybeRun(tx4, `4) pool_withdraw_usdy ${WITHDRAW_Y} (extract->swap->deposit)`)

  if (!isExecute()) {
    warn('All steps DRY-RUN only. Re-run with --execute to submit (sequentially, in order).')
    warn('Reuse one pool across steps: USDY_POOL=0x... EXECUTE=1, run once to create then set it.')
  } else {
    ok('usdy e2e complete — invest + unwind round-tripped through live USDY + Cetus.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
