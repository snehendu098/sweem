module sweem_adapters::claim_liquidity_scallop;

use sui::coin::Coin;
use sui::clock::Clock;
use sweem_core::stream_pool::{Self, StreamPool};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig};
use sweem_adapters::scallop::pool_withdraw_scallop;
use protocol::market::Market;
use protocol::version::Version;

#[error]
const EInsufficientPoolLiquidity: vector<u8> = b"Pool cash + Scallop position cannot cover claim";

public fun claim_with_liquidity_scallop<T>(
    pool: &mut StreamPool<T>,
    version: &Version,
    market: &mut Market,
    registry: &ProtocolRegistry,
    config: &ProtocolConfig,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);

    let cash = stream_pool::balance_value(pool);
    if (cash < claimable) {
        let shortfall = claimable - cash;
        pool_withdraw_scallop<T>(pool, version, market, config, registry, clock, shortfall, ctx);
        assert!(stream_pool::balance_value(pool) >= claimable, EInsufficientPoolLiquidity);
    };

    stream_pool::claim(pool, clock, ctx)
}
