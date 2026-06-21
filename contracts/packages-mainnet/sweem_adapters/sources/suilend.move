module sweem_adapters::suilend;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;

use suilend::lending_market::{
    Self as lending_market, LendingMarket,
    deposit_liquidity_and_mint_ctokens, redeem_ctokens_and_withdraw_liquidity,
};
use suilend::reserve::{Self as reserve, CToken};
use suilend::suilend::MAIN_POOL;
use suilend::decimal;

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

const PROTOCOL_NAME: vector<u8> = b"suilend";

#[error] const ENotOrg: vector<u8> = b"Caller is not the org";
#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"Suilend not approved in registry";
#[error] const ENoPosition: vector<u8> = b"No Suilend position on this pool";
#[error] const ENoVaultPosition: vector<u8> = b"No Suilend position on this vault bucket";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";

// Coin<CToken<MAIN_POOL, T>> is key+store → stored via dof.
// SuilendPosition is store-only → stored via df.
public struct SuilendPoolCTokenKey() has copy, drop, store;
public struct SuilendVaultCTokenKey() has copy, drop, store;
public struct SuilendPoolPositionKey() has copy, drop, store;
public struct SuilendVaultPositionKey() has copy, drop, store;

public struct SuilendPosition has store {
    deposited_value: u64,
}

public struct SuilendInvested has copy, drop { object_id: ID, amount: u64 }
public struct SuilendReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// Org moves idle pool balance into Suilend to earn yield.
public fun pool_invest_suilend<T>(
    pool: &mut StreamPool<T>,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    registry: &ProtocolRegistry,
    clock: &Clock,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);

    let reserve_idx = lending_market::reserve_array_index<MAIN_POOL, T>(lending_market);
    let coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);
    let ctoken: Coin<CToken<MAIN_POOL, T>> = deposit_liquidity_and_mint_ctokens<MAIN_POOL, T>(
        lending_market, reserve_idx, clock, coin, ctx,
    );

    let uid = borrow_uid_mut(pool, ctx);
    if (dof::exists(uid, SuilendPoolCTokenKey())) {
        let existing: &mut Coin<CToken<MAIN_POOL, T>> = dof::borrow_mut(uid, SuilendPoolCTokenKey());
        existing.join(ctoken);
    } else {
        dof::add(uid, SuilendPoolCTokenKey(), ctoken);
    };

    if (df::exists(uid, SuilendPoolPositionKey())) {
        let pos: &mut SuilendPosition = df::borrow_mut(uid, SuilendPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, SuilendPoolPositionKey(), SuilendPosition { deposited_value: amount });
    };

    event::emit(SuilendInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

// Redeems only `shortfall` underlying worth of cToken from the pool position.
// If the position covers more than needed, the remainder stays invested.
public(package) fun pool_withdraw_suilend<T>(
    pool: &mut StreamPool<T>,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    shortfall: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(dof::exists(borrow_uid(pool), SuilendPoolCTokenKey()), ENoPosition);

    let total_ctoken = dof::borrow<SuilendPoolCTokenKey, Coin<CToken<MAIN_POOL, T>>>(
        borrow_uid(pool), SuilendPoolCTokenKey()
    ).value();

    let reserve_idx = lending_market::reserve_array_index<MAIN_POOL, T>(lending_market);

    // Compute how many cTokens cover `shortfall` underlying at current ratio.
    // ratio = ctoken_ratio (underlying per cToken, >= 1); ctoken_needed = ceil(shortfall / ratio).
    // Read BEFORE redeem compounds interest → ratio is a weak lower bound → ctoken_needed is an
    // upper bound → conservative (never under-delivers the shortfall).
    let ctoken_to_redeem = {
        let res = lending_market::reserve<MAIN_POOL, T>(lending_market);
        let ratio = reserve::ctoken_ratio<MAIN_POOL>(res);
        let needed = decimal::ceil(decimal::div(decimal::from(shortfall), ratio));
        // +1 buffer: floor math inside redeem may shave an underlying unit.
        let needed_buf = needed + 1;
        if (needed_buf >= total_ctoken) { total_ctoken } else { needed_buf }
    };

    let is_full_redeem = ctoken_to_redeem >= total_ctoken;

    let ctoken = if (is_full_redeem) {
        dof::remove(borrow_uid_mut_yield(pool, registry), SuilendPoolCTokenKey())
    } else {
        let stored: &mut Coin<CToken<MAIN_POOL, T>> = dof::borrow_mut(
            borrow_uid_mut_yield(pool, registry), SuilendPoolCTokenKey()
        );
        stored.split(ctoken_to_redeem, ctx)
    };

    let deposited_value = df::borrow<SuilendPoolPositionKey, SuilendPosition>(
        borrow_uid(pool), SuilendPoolPositionKey(),
    ).deposited_value;

    let gross_coin: Coin<T> = redeem_ctokens_and_withdraw_liquidity<MAIN_POOL, T>(
        lending_market, reserve_idx, clock, ctoken, option::none(), ctx,
    );
    let gross = gross_coin.value();

    // Pro-rate principal: only the redeemed fraction of cTokens counts as principal here.
    let principal_share = if (is_full_redeem) {
        deposited_value
    } else {
        // principal_share = ceil(deposited_value * ctoken_to_redeem / total_ctoken)
        // Round up so we never overcount yield earned (fee is taken on gross - principal_share).
        let ps_u128 = oz_u128::mul_div(
            deposited_value as u128,
            ctoken_to_redeem as u128,
            total_ctoken as u128,
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
        let SuilendPosition { deposited_value: _ } = df::remove(
            borrow_uid_mut_yield(pool, registry), SuilendPoolPositionKey()
        );
    } else {
        let pos: &mut SuilendPosition = df::borrow_mut(
            borrow_uid_mut_yield(pool, registry), SuilendPoolPositionKey()
        );
        pos.deposited_value = if (deposited_value > principal_share) {
            deposited_value - principal_share
        } else { 0 };
    };

    event::emit(SuilendReturned {
        object_id: borrow_uid(pool).to_inner(),
        gross, yield_fee: fee, net: gross - fee,
    });
}

// Employee moves claimed tokens from their vault bucket into Suilend.
public fun vault_invest_suilend<T>(
    vault: &mut EmployeeVault,
    token_name: std::string::String,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    registry: &ProtocolRegistry,
    clock: &Clock,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);

    let reserve_idx = lending_market::reserve_array_index<MAIN_POOL, T>(lending_market);
    let coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);
    let ctoken: Coin<CToken<MAIN_POOL, T>> = deposit_liquidity_and_mint_ctokens<MAIN_POOL, T>(
        lending_market, reserve_idx, clock, coin, ctx,
    );

    let buid = bucket_uid_mut(bucket, registry);
    if (dof::exists(buid, SuilendVaultCTokenKey())) {
        let existing: &mut Coin<CToken<MAIN_POOL, T>> = dof::borrow_mut(buid, SuilendVaultCTokenKey());
        existing.join(ctoken);
    } else {
        dof::add(buid, SuilendVaultCTokenKey(), ctoken);
    };

    if (df::exists(buid, SuilendVaultPositionKey())) {
        let pos: &mut SuilendPosition = df::borrow_mut(buid, SuilendVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, SuilendVaultPositionKey(), SuilendPosition { deposited_value: amount });
    };

    event::emit(SuilendInvested { object_id: vault_id, amount });
}

// Employee redeems their full Suilend position back into their vault bucket.
public fun vault_withdraw_suilend<T>(
    vault: &mut EmployeeVault,
    token_name: std::string::String,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), SuilendVaultCTokenKey()), ENoVaultPosition);

    let reserve_idx = lending_market::reserve_array_index<MAIN_POOL, T>(lending_market);
    let ctoken: Coin<CToken<MAIN_POOL, T>> = dof::remove(bucket_uid_mut(bucket, registry), SuilendVaultCTokenKey());

    let deposited_value = df::borrow<SuilendVaultPositionKey, SuilendPosition>(
        bucket_uid_mut(bucket, registry), SuilendVaultPositionKey(),
    ).deposited_value;

    let gross_coin: Coin<T> = redeem_ctokens_and_withdraw_liquidity<MAIN_POOL, T>(
        lending_market, reserve_idx, clock, ctoken, option::none(), ctx,
    );
    let gross = gross_coin.value();

    let yield_earned = if (gross > deposited_value) { gross - deposited_value } else { 0 };
    let fee = oz_u64::mul_div(yield_earned, vault_yield_fee_bps(config), 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_bucket_from_yield(bucket, gross_coin.into_balance());

    let SuilendPosition { deposited_value: _ } = df::remove(
        bucket_uid_mut(bucket, registry), SuilendVaultPositionKey()
    );

    event::emit(SuilendReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}

// Employee-side claim helper for a pool split across multiple protocols. Pulls up to
// `max_amount` of the CALLER'S OWN claim shortfall out of Suilend into the pool's idle
// balance, then returns (it does NOT claim). Compose in a PTB with any other
// `cover_claim_from_*` calls and a final `stream_pool::claim`. Safe to be public: the
// draw is bounded by the caller's own claimable, so non-employees and over-draws are
// no-ops. Suilend self-caps redemption to the full position, so `max_amount` may be the
// full shortfall.
public fun cover_claim_from_suilend<T>(
    pool: &mut StreamPool<T>,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    max_amount: u64,
    ctx: &mut TxContext,
) {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);
    let cash = stream_pool::balance_value(pool);
    if (cash < claimable) {
        let shortfall = claimable - cash;
        let draw = if (shortfall < max_amount) { shortfall } else { max_amount };
        if (draw > 0) {
            pool_withdraw_suilend<T>(pool, lending_market, config, registry, clock, draw, ctx);
        };
    };
}

// Org voluntarily unwinds `amount` (underlying) of the pool's Suilend position back to
// idle cash — for rebalancing into another protocol or topping up idle cash. Org-gated.
// Suilend redeems ceil(amount) worth of cToken, capped at the full position.
public fun org_withdraw_suilend<T>(
    pool: &mut StreamPool<T>,
    lending_market: &mut LendingMarket<MAIN_POOL>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock: &Clock,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    pool_withdraw_suilend<T>(pool, lending_market, config, registry, clock, amount, ctx);
}
