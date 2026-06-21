// Cetus aggregator swap helper — the USDC<->USDY hop for the USDY adapter.
// The on-chain adapter is swap-agnostic: `*_extract` hands us a Coin<T>, we swap
// it to Coin<Y> here inside the same PTB, and `*_deposit` consumes the result.
// Routing is fetched over HTTP from Cetus (no SuiClient needed); routerSwap appends
// the swap moveCalls onto the passed Transaction and returns the output coin arg.

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { AggregatorClient, Env } from '@cetusprotocol/aggregator-sdk'

// One mainnet aggregator client. `client` (a SuiGrpcClient) is only needed for
// simulation/account-cap flows we don't use — route discovery is the default
// HTTP endpoint and routerSwap is pure PTB construction.
let _client: AggregatorClient | null = null
function aggregator(): AggregatorClient {
  if (!_client) _client = new AggregatorClient({ env: Env.Mainnet })
  return _client
}

export interface CetusSwapArgs {
  inputCoin: TransactionObjectArgument // coin to spend (from *_extract)
  fromType: string // coin type of inputCoin
  toType: string // desired output coin type
  amountIn: bigint // exact input amount (base units)
  slippageBps: number // e.g. 100 = 1%
}

// Append a Cetus swap to `tx`, fully consuming `inputCoin`, returning the output
// Coin<toType> argument for use later in the same PTB. Throws if no route is found
// — the caller's whole tx then fails (never partially executes).
export async function appendCetusSwap(
  tx: Transaction,
  { inputCoin, fromType, toType, amountIn, slippageBps }: CetusSwapArgs,
): Promise<TransactionObjectArgument> {
  const client = aggregator()
  const router = await client.findRouters({
    from: fromType,
    target: toType,
    amount: amountIn, // BN | string | number | bigint all accepted
    byAmountIn: true, // fix the input amount
  })
  if (!router) throw new Error(`No Cetus route ${fromType} → ${toType}`)
  // slippage is a 0..1 fraction; routerSwap enforces the implied min_out on-chain.
  return client.routerSwap({ router, txb: tx, inputCoin, slippage: slippageBps / 10_000 })
}
