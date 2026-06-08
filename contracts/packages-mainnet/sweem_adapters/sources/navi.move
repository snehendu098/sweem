module sweem_adapters::navi;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;

use lending_core::incentive_v3::{Self, Incentive as IncentiveV3, deposit_with_account_cap, withdraw_with_account_cap};
use lending_core::incentive_v2::Incentive as IncentiveV2;
use lending_core::storage::Storage;
use lending_core::pool::Pool;
use lending_core::account::AccountCap;
use oracle::oracle::PriceOracle;

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
use openzeppelin_math::rounding;
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"navi";

#[error] const ENotOrg: vector<u8> = b"Caller is not the org";
#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"Navi not approved in registry";
#[error] const ENoAccountCap: vector<u8> = b"No AccountCap on pool - call store_pool_account_cap first";
#[error] const ENoVaultAccountCap: vector<u8> = b"No AccountCap on vault - call store_vault_account_cap first";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";

// AccountCap is key+store → stored via dof.
// NaviPosition is store-only → stored via df.
// DF/DOF keys. Struct constructors are always module-private in Move, so these
// keys can only be packed inside this module regardless of type visibility.
public struct NaviPoolCapKey() has copy, drop, store;
public struct NaviVaultCapKey() has copy, drop, store;
public struct NaviPoolPositionKey() has copy, drop, store;
public struct NaviVaultPositionKey() has copy, drop, store;

public struct NaviPosition has store {
    deposited_value: u64,
}

public struct NaviInvested has copy, drop { object_id: ID, amount: u64 }
public struct NaviReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// Org stores their Navi AccountCap into the pool once at setup.
public fun store_pool_account_cap<T>(
    pool: &mut StreamPool<T>,
    cap: AccountCap,
    ctx: &TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    dof::add(borrow_uid_mut(pool, ctx), NaviPoolCapKey(), cap);
}

// Employee stores their Navi AccountCap into their vault once at setup.
public fun store_vault_account_cap(
    vault: &mut EmployeeVault,
    cap: AccountCap,
    ctx: &TxContext,
) {
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);
    dof::add(vault_uid_mut(vault, ctx), NaviVaultCapKey(), cap);
}

// Org moves idle pool balance into Navi to earn yield.
public fun pool_invest_navi<T>(
    pool: &mut StreamPool<T>,
    storage: &mut Storage,
    navi_pool: &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut IncentiveV3,
    registry: &ProtocolRegistry,
    clock: &Clock,
    asset_id: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    assert!(dof::exists(borrow_uid(pool), NaviPoolCapKey()), ENoAccountCap);

    let coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);
    let cap: &mut AccountCap = dof::borrow_mut(borrow_uid_mut(pool, ctx), NaviPoolCapKey());
    deposit_with_account_cap<T>(clock, storage, navi_pool, asset_id, coin, incentive_v2, incentive_v3, cap);

    let uid = borrow_uid_mut(pool, ctx);
    if (df::exists(uid, NaviPoolPositionKey())) {
        let pos: &mut NaviPosition = df::borrow_mut(uid, NaviPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, NaviPoolPositionKey(), NaviPosition { deposited_value: amount });
    };

    event::emit(NaviInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

// Withdraws from Navi back into pool, deducts org yield fee.
// Called by claim_liquidity when pool cash is insufficient for a claim.
public(package) fun pool_withdraw_navi<T>(
    pool: &mut StreamPool<T>,
    storage: &mut Storage,
    navi_pool: &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut IncentiveV3,
    oracle: &PriceOracle,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    asset_id: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(dof::exists(borrow_uid(pool), NaviPoolCapKey()), ENoAccountCap);

    // Note: Navi accrues yield to position size (aToken model), not as surplus on
    // withdrawal. yield_earned will be ~0 on partial withdrawals; the yield fee is
    // collected primarily on full exit.
    let cap: &mut AccountCap = dof::borrow_mut(borrow_uid_mut_yield(pool, registry), NaviPoolCapKey());
    let gross_bal: Balance<T> = withdraw_with_account_cap<T>(
        clock, oracle, storage, navi_pool, asset_id, amount,
        incentive_v2, incentive_v3, cap,
    );

    let gross = gross_bal.value();
    let pos_deposited = df::borrow<NaviPoolPositionKey, NaviPosition>(
        borrow_uid(pool), NaviPoolPositionKey(),
    ).deposited_value;

    // principal_share = min(amount, pos_deposited): at most `amount` of the withdrawal is principal
    let principal_share = if (amount <= pos_deposited) { amount } else { pos_deposited };
    let yield_earned = if (gross > principal_share) { gross - principal_share } else { 0 };
    let fee = oz_u64::mul_div(yield_earned, org_yield_fee_bps(config), 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);

    let mut gross_coin = coin::from_balance(gross_bal, ctx);
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_balance_from_yield(pool, gross_coin.into_balance());

    let pos: &mut NaviPosition = df::borrow_mut(borrow_uid_mut_yield(pool, registry), NaviPoolPositionKey());
    pos.deposited_value = pos_deposited - principal_share;

    event::emit(NaviReturned {
        object_id: borrow_uid(pool).to_inner(),
        gross, yield_fee: fee, net: gross - fee,
    });
}

// Employee moves claimed tokens from their vault bucket into Navi.
public fun vault_invest_navi<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    storage: &mut Storage,
    navi_pool: &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut IncentiveV3,
    registry: &ProtocolRegistry,
    clock: &Clock,
    asset_id: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);

    // Check cap before borrowing buid (temporary borrow, released after assert)
    assert!(dof::exists(bucket_uid_mut(bucket, registry), NaviVaultCapKey()), ENoVaultAccountCap);
    // Split coin while bucket is free (buid not held)
    let coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);

    // Borrow buid + cap in a block so cap drops before we touch bucket again
    {
        let cap: &mut AccountCap = dof::borrow_mut(bucket_uid_mut(bucket, registry), NaviVaultCapKey());
        deposit_with_account_cap<T>(clock, storage, navi_pool, asset_id, coin, incentive_v2, incentive_v3, cap);
    };

    let buid = bucket_uid_mut(bucket, registry);
    if (df::exists(buid, NaviVaultPositionKey())) {
        let pos: &mut NaviPosition = df::borrow_mut(buid, NaviVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, NaviVaultPositionKey(), NaviPosition { deposited_value: amount });
    };

    event::emit(NaviInvested { object_id: vault_id, amount });
}

// Employee withdraws their Navi position back into their vault bucket.
public fun vault_withdraw_navi<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    storage: &mut Storage,
    navi_pool: &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut IncentiveV3,
    oracle: &PriceOracle,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    asset_id: u8,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), NaviVaultCapKey()), ENoVaultAccountCap);

    // Note: Navi accrues yield to position size (aToken model), not as surplus on
    // withdrawal. yield_earned will be ~0 on partial withdrawals; the yield fee is
    // collected primarily on full exit.
    // Withdraw in a block so cap + buid drop before we merge back into bucket
    let gross_bal: Balance<T> = {
        let cap: &mut AccountCap = dof::borrow_mut(bucket_uid_mut(bucket, registry), NaviVaultCapKey());
        withdraw_with_account_cap<T>(
            clock, oracle, storage, navi_pool, asset_id, amount,
            incentive_v2, incentive_v3, cap,
        )
    };

    let gross = gross_bal.value();

    // Read deposited_value while bucket is free (cap block ended)
    let pos_deposited = df::borrow<NaviVaultPositionKey, NaviPosition>(
        bucket_uid_mut(bucket, registry), NaviVaultPositionKey(),
    ).deposited_value;

    // principal_share = min(amount, pos_deposited): at most `amount` of the withdrawal is principal
    let principal_share = if (amount <= pos_deposited) { amount } else { pos_deposited };
    let yield_earned = if (gross > principal_share) { gross - principal_share } else { 0 };
    let fee = oz_u64::mul_div(yield_earned, vault_yield_fee_bps(config), 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);

    let mut gross_coin = coin::from_balance(gross_bal, ctx);
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    // Merge back — bucket is free since no buid held
    merge_bucket_from_yield(bucket, gross_coin.into_balance());

    // Update position
    let pos: &mut NaviPosition = df::borrow_mut(bucket_uid_mut(bucket, registry), NaviVaultPositionKey());
    pos.deposited_value = pos_deposited - principal_share;

    event::emit(NaviReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}
