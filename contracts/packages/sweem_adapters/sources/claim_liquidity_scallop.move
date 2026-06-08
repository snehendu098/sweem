module sweem_adapters::claim_liquidity_scallop;

use sui::coin::Coin;
use sui::clock::Clock;
use sweem_core::stream_pool::{Self, StreamPool};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig};

#[error]
const EInsufficientPoolLiquidity: vector<u8> = b"Total pool balance + yield positions cannot cover claim";

public fun claim_with_liquidity_scallop<T>(
    pool: &mut StreamPool<T>,
    _registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);

    if (stream_pool::balance_value(pool) < claimable) {
        assert!(stream_pool::balance_value(pool) >= claimable, EInsufficientPoolLiquidity);
    };

    stream_pool::claim(pool, clock, ctx)
}
