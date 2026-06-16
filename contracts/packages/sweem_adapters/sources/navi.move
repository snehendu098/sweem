module sweem_adapters::navi;

use sui::dynamic_field as df;
use sui::event;
use sui::clock::Clock;
use sweem_core::stream_pool::{Self, StreamPool, borrow_uid_mut, borrow_uid};
use sweem_core::employee_vault::{Self as employee_vault, EmployeeVault, borrow_bucket_mut, vault_uid_mut, bucket_uid_mut};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig, is_approved};
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"navi";

public struct NaviPoolKey() has copy, drop, store;
public struct NaviVaultKey() has copy, drop, store;

// Tracks deposited principal for yield fee calculation at withdrawal
public struct NaviPosition has store {
    deposited_value: u64,
}

public struct NaviDeposited has copy, drop { object_id: sui::object::ID, amount: u64 }
public struct NaviWithdrawn has copy, drop { object_id: sui::object::ID, gross: u64, fee: u64, net: u64 }

public fun pool_invest_navi<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    let name = std::string::utf8(PROTOCOL_NAME);
    assert!(is_approved(registry, &name), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);

    let pool_id = borrow_uid(pool).to_inner();
    let uid = borrow_uid_mut(pool);
    if (df::exists(uid, NaviPoolKey())) {
        let pos: &mut NaviPosition = df::borrow_mut(uid, NaviPoolKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, NaviPoolKey(), NaviPosition { deposited_value: amount });
    };

    event::emit(NaviDeposited { object_id: pool_id, amount });
}

public(package) fun pool_withdraw_navi<T>(
    pool: &StreamPool<T>,
    registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    amount: u64,
    _ctx: &TxContext,
) {
    let name = std::string::utf8(PROTOCOL_NAME);
    assert!(is_approved(registry, &name), 0);

    let oid = borrow_uid(pool).to_inner();
    event::emit(NaviWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}

public fun vault_invest_navi<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    let name = std::string::utf8(PROTOCOL_NAME);
    assert!(is_approved(registry, &name), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);

    let vault_id = vault_uid_mut(vault).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    let buid = bucket_uid_mut(bucket);
    if (df::exists(buid, NaviVaultKey())) {
        let pos: &mut NaviPosition = df::borrow_mut(buid, NaviVaultKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, NaviVaultKey(), NaviPosition { deposited_value: amount });
    };

    event::emit(NaviDeposited { object_id: vault_id, amount });
}

public fun vault_withdraw_navi<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    amount: u64,
    ctx: &mut TxContext,
) {
    let name = std::string::utf8(PROTOCOL_NAME);
    assert!(is_approved(registry, &name), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);

    let _bucket = borrow_bucket_mut<T>(vault, token_name);

    let oid = vault_uid_mut(vault).to_inner();
    event::emit(NaviWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}

// Stub mirror of mainnet `cover_claim_from_navi` — same API shape for the frontend.
// Stubs don't move real funds (invest only tracks a DF), so this is a bounded no-op
// that emits the withdraw event. Compose with a final `stream_pool::claim`.
public fun cover_claim_from_navi<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    config: &ProtocolConfig,
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
            pool_withdraw_navi<T>(pool, registry, config, draw, ctx);
        };
    };
}

// Stub mirror of mainnet `org_withdraw_navi` — org-gated unwind for rebalancing.
public fun org_withdraw_navi<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    config: &ProtocolConfig,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), 1);
    pool_withdraw_navi<T>(pool, registry, config, amount, ctx);
}
