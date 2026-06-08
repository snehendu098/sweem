module sweem_adapters::claim_liquidity;

use sui::coin::Coin;
use sui::clock::Clock;
use sweem_core::stream_pool::{Self, StreamPool};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig};
use sweem_adapters::navi::pool_withdraw_navi;
use lending_core::incentive_v3::Incentive as IncentiveV3;
use lending_core::incentive_v2::Incentive as IncentiveV2;
use lending_core::storage::Storage;
use lending_core::pool::Pool;
use oracle::oracle::PriceOracle;

#[error]
const EInsufficientPoolLiquidity: vector<u8> = b"Pool cash + Navi position cannot cover claim";

public fun claim_with_liquidity<T>(
    pool: &mut StreamPool<T>,
    storage: &mut Storage,
    navi_pool: &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut IncentiveV3,
    oracle: &PriceOracle,
    registry: &ProtocolRegistry,
    config: &ProtocolConfig,
    clock: &Clock,
    asset_id: u8,
    ctx: &mut TxContext,
): Coin<T> {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);

    if (stream_pool::balance_value(pool) < claimable) {
        let shortfall = claimable - stream_pool::balance_value(pool);
        pool_withdraw_navi<T>(
            pool, storage, navi_pool, incentive_v2, incentive_v3,
            oracle, config, clock, registry, asset_id, shortfall, ctx,
        );
        assert!(stream_pool::balance_value(pool) >= claimable, EInsufficientPoolLiquidity);
    };

    stream_pool::claim(pool, clock, ctx)
}
