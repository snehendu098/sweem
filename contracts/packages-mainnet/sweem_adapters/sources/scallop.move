module sweem_adapters::scallop;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;

use protocol::mint::mint;
use protocol::redeem::redeem;
use protocol::market::Market;
use protocol::version::Version;
use protocol::reserve::{Self, MarketCoin};

use x::wit_table;

use sweem_core::stream_pool::{
    Self, StreamPool,
    borrow_uid, borrow_uid_mut, borrow_uid_mut_yield,
    split_balance_for_invest, merge_balance_from_yield,
};
use sweem_core::employee_vault::{
    Self as employee_vault, EmployeeVault,
    borrow_bucket_mut, vault_uid_mut, bucket_uid_mut,
    split_bucket_for_invest, merge_bucket_from_yield,
};
use sweem_registry::registry::{
    ProtocolRegistry, ProtocolConfig,
    is_approved, org_yield_fee_bps, vault_yield_fee_bps, treasury,
};
use openzeppelin_math::u64 as oz_u64;
use openzeppelin_math::u128 as oz_u128;
use openzeppelin_math::rounding;
use std::type_name;
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"scallop";

#[error] const ENotOrg: vector<u8> = b"Caller is not the org";
#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"Scallop not approved in registry";
#[error] const ENoPosition: vector<u8> = b"No Scallop position on this pool";
#[error] const ENoVaultPosition: vector<u8> = b"No Scallop position on this vault bucket";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";
#[error] const EInvalidMarketState: vector<u8> = b"Scallop market backing underflows — revenue exceeds cash+debt";
#[error] const EZeroSupply: vector<u8> = b"Scallop market coin supply is zero";

// Coin<MarketCoin<T>> is key+store → stored via dof.
// ScallopPosition is store-only → stored via df.
public struct ScallopPoolMarketCoinKey() has copy, drop, store;
public struct ScallopVaultMarketCoinKey() has copy, drop, store;
public struct ScallopPoolPositionKey() has copy, drop, store;
public struct ScallopVaultPositionKey() has copy, drop, store;

public struct ScallopPosition has store {
    deposited_value: u64,
}

public struct ScallopInvested has copy, drop { object_id: ID, amount: u64 }
public struct ScallopReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// Org moves idle pool balance into Scallop to earn yield.
public fun pool_invest_scallop<T>(
    pool: &mut StreamPool<T>,
    version: &Version,
    market: &mut Market,
    registry: &ProtocolRegistry,
    clock: &Clock,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);

    let coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);
    let market_coin: Coin<MarketCoin<T>> = mint<T>(version, market, coin, clock, ctx);

    let uid = borrow_uid_mut(pool, ctx);
    if (dof::exists(uid, ScallopPoolMarketCoinKey())) {
        let existing: &mut Coin<MarketCoin<T>> = dof::borrow_mut(uid, ScallopPoolMarketCoinKey());
        existing.join(market_coin);
    } else {
        dof::add(uid, ScallopPoolMarketCoinKey(), market_coin);
    };

    if (df::exists(uid, ScallopPoolPositionKey())) {
        let pos: &mut ScallopPosition = df::borrow_mut(uid, ScallopPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, ScallopPoolPositionKey(), ScallopPosition { deposited_value: amount });
    };

    event::emit(ScallopInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

// Redeems only `shortfall` USDC worth of sCoin from the pool position.
// If the position covers more than needed, the remainder stays invested.
// Called by claim_with_liquidity_scallop when pool cash is insufficient.
public(package) fun pool_withdraw_scallop<T>(
    pool: &mut StreamPool<T>,
    version: &Version,
    market: &mut Market,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    shortfall: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(dof::exists(borrow_uid(pool), ScallopPoolMarketCoinKey()), ENoPosition);

    let total_scoin = dof::borrow<ScallopPoolMarketCoinKey, Coin<MarketCoin<T>>>(
        borrow_uid(pool), ScallopPoolMarketCoinKey()
    ).value();

    // Compute how many sCoins cover `shortfall` underlying at current exchange rate.
    // rate = (cash + debt - revenue) / market_coin_supply  →  scoin_needed = ceil(shortfall / rate)
    let scoin_to_redeem = {
        let reserve = protocol::market::vault(market);
        let sheets = reserve::balance_sheets(reserve);
        let bs = wit_table::borrow(sheets, type_name::get<T>());
        let (cash, debt, revenue, supply) = reserve::balance_sheet(bs);
        assert!(supply > 0, EZeroSupply);
        assert!(cash + debt >= revenue, EInvalidMarketState);
        let backing = cash + debt - revenue; // underlying backing all sCoins
        // scoin_needed = ceil(shortfall * supply / backing)
        let needed_u128 = oz_u128::mul_div(
            shortfall as u128,
            supply as u128,
            backing as u128,
            rounding::up(),
        ).destroy_or!(abort EArithmeticOverflow);
        // +1 buffer: floor(redeem) math in Scallop may shave a USDC unit
        let needed = (needed_u128 as u64) + 1;
        if (needed >= total_scoin) { total_scoin } else { needed }
    };

    let is_full_redeem = scoin_to_redeem >= total_scoin;

    let market_coin = if (is_full_redeem) {
        dof::remove(borrow_uid_mut_yield(pool, registry), ScallopPoolMarketCoinKey())
    } else {
        let stored: &mut Coin<MarketCoin<T>> = dof::borrow_mut(
            borrow_uid_mut_yield(pool, registry), ScallopPoolMarketCoinKey()
        );
        stored.split(scoin_to_redeem, ctx)
    };

    let deposited_value = df::borrow<ScallopPoolPositionKey, ScallopPosition>(
        borrow_uid(pool), ScallopPoolPositionKey(),
    ).deposited_value;

    let gross_coin: Coin<T> = redeem<T>(version, market, market_coin, clock, ctx);
    let gross = gross_coin.value();

    // Pro-rate principal: only the redeemed fraction of sCoins counts as principal here.
    let principal_share = if (is_full_redeem) {
        deposited_value
    } else {
        // principal_share = deposited_value * scoin_to_redeem / total_scoin
        // Round up so we never overcount yield earned (fee is taken on gross - principal_share).
        let ps_u128 = oz_u128::mul_div(
            deposited_value as u128,
            scoin_to_redeem as u128,
            total_scoin as u128,
            rounding::up(),
        ).destroy_or!(abort EArithmeticOverflow);
        ps_u128 as u64
    };

    let yield_earned = if (gross > principal_share) { gross - principal_share } else { 0 };
    let fee = oz_u64::mul_div(yield_earned, org_yield_fee_bps(config), 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_balance_from_yield(pool, gross_coin.into_balance());

    // Update or remove the position DF.
    if (is_full_redeem) {
        let ScallopPosition { deposited_value: _ } = df::remove(
            borrow_uid_mut_yield(pool, registry), ScallopPoolPositionKey()
        );
    } else {
        let pos: &mut ScallopPosition = df::borrow_mut(
            borrow_uid_mut_yield(pool, registry), ScallopPoolPositionKey()
        );
        pos.deposited_value = if (deposited_value > principal_share) {
            deposited_value - principal_share
        } else { 0 };
    };

    event::emit(ScallopReturned {
        object_id: borrow_uid(pool).to_inner(),
        gross, yield_fee: fee, net: gross - fee,
    });
}

// Employee moves claimed tokens from their vault bucket into Scallop.
public fun vault_invest_scallop<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    version: &Version,
    market: &mut Market,
    registry: &ProtocolRegistry,
    clock: &Clock,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);

    let coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);
    let market_coin: Coin<MarketCoin<T>> = mint<T>(version, market, coin, clock, ctx);

    let buid = bucket_uid_mut(bucket, registry);
    if (dof::exists(buid, ScallopVaultMarketCoinKey())) {
        let existing: &mut Coin<MarketCoin<T>> = dof::borrow_mut(buid, ScallopVaultMarketCoinKey());
        existing.join(market_coin);
    } else {
        dof::add(buid, ScallopVaultMarketCoinKey(), market_coin);
    };

    if (df::exists(buid, ScallopVaultPositionKey())) {
        let pos: &mut ScallopPosition = df::borrow_mut(buid, ScallopVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, ScallopVaultPositionKey(), ScallopPosition { deposited_value: amount });
    };

    event::emit(ScallopInvested { object_id: vault_id, amount });
}

// Employee redeems their full Scallop position back into their vault bucket.
public fun vault_withdraw_scallop<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    version: &Version,
    market: &mut Market,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), ScallopVaultMarketCoinKey()), ENoVaultPosition);

    let market_coin: Coin<MarketCoin<T>> = dof::remove(bucket_uid_mut(bucket, registry), ScallopVaultMarketCoinKey());

    let deposited_value = df::borrow<ScallopVaultPositionKey, ScallopPosition>(
        bucket_uid_mut(bucket, registry), ScallopVaultPositionKey(),
    ).deposited_value;

    let gross_coin: Coin<T> = redeem<T>(version, market, market_coin, clock, ctx);
    let gross = gross_coin.value();

    let yield_earned = if (gross > deposited_value) { gross - deposited_value } else { 0 };
    let fee = oz_u64::mul_div(yield_earned, vault_yield_fee_bps(config), 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_bucket_from_yield(bucket, gross_coin.into_balance());

    let ScallopPosition { deposited_value: _ } = df::remove(
        bucket_uid_mut(bucket, registry), ScallopVaultPositionKey()
    );

    event::emit(ScallopReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}
