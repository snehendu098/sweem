module sweem_adapters::suilend;

use sui::dynamic_field as df;
use sui::event;
use sui::clock::Clock;
use sweem_core::stream_pool::{Self, StreamPool, borrow_uid_mut, borrow_uid};
use sweem_core::employee_vault::{Self as employee_vault, EmployeeVault, borrow_bucket_mut, vault_uid_mut, bucket_uid_mut};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig, is_approved};
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"suilend";

public struct SuilendPoolKey() has copy, drop, store;
public struct SuilendVaultKey() has copy, drop, store;

public struct SuilendPosition has store {
    deposited_value: u64,
}

public struct SuilendDeposited has copy, drop { object_id: sui::object::ID, amount: u64 }
public struct SuilendWithdrawn has copy, drop { object_id: sui::object::ID, gross: u64, fee: u64, net: u64 }

public fun pool_invest_suilend<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);

    let pool_id = borrow_uid(pool).to_inner();
    let uid = borrow_uid_mut(pool);
    if (df::exists(uid, SuilendPoolKey())) {
        let pos: &mut SuilendPosition = df::borrow_mut(uid, SuilendPoolKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, SuilendPoolKey(), SuilendPosition { deposited_value: amount });
    };

    event::emit(SuilendDeposited { object_id: pool_id, amount });
}

public(package) fun pool_withdraw_suilend<T>(
    pool: &StreamPool<T>,
    registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    amount: u64,
    _ctx: &TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);

    let oid = borrow_uid(pool).to_inner();
    event::emit(SuilendWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}

public fun vault_invest_suilend<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);

    let vault_id = vault_uid_mut(vault).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    let buid = bucket_uid_mut(bucket);
    if (df::exists(buid, SuilendVaultKey())) {
        let pos: &mut SuilendPosition = df::borrow_mut(buid, SuilendVaultKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, SuilendVaultKey(), SuilendPosition { deposited_value: amount });
    };

    event::emit(SuilendDeposited { object_id: vault_id, amount });
}

public fun vault_withdraw_suilend<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);

    let _bucket = borrow_bucket_mut<T>(vault, token_name);

    let oid = vault_uid_mut(vault).to_inner();
    event::emit(SuilendWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}

// Stub mirror of mainnet `cover_claim_from_suilend` — same API shape for the frontend.
// Stubs don't move real funds, so this is a bounded no-op that emits the withdraw event.
// Compose with a final `stream_pool::claim`.
public fun cover_claim_from_suilend<T>(
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
            pool_withdraw_suilend<T>(pool, registry, config, draw, ctx);
        };
    };
}

// Stub mirror of mainnet `org_withdraw_suilend` — org-gated unwind for rebalancing.
public fun org_withdraw_suilend<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    config: &ProtocolConfig,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), 1);
    pool_withdraw_suilend<T>(pool, registry, config, amount, ctx);
}
