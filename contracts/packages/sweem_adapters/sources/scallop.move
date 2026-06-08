module sweem_adapters::scallop;

use sui::dynamic_field as df;
use sui::event;
use sweem_core::stream_pool::{Self, StreamPool, borrow_uid_mut, borrow_uid};
use sweem_core::employee_vault::{Self as employee_vault, EmployeeVault, borrow_bucket_mut, vault_uid_mut, bucket_uid_mut};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig, is_approved};
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"scallop";

public struct ScallopPoolKey() has copy, drop, store;
public struct ScallopVaultKey() has copy, drop, store;

public struct ScallopPosition has store {
    deposited_value: u64,
}

public struct ScallopDeposited has copy, drop { object_id: sui::object::ID, amount: u64 }
public struct ScallopWithdrawn has copy, drop { object_id: sui::object::ID, gross: u64, fee: u64, net: u64 }

public fun pool_invest_scallop<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);

    let pool_id = borrow_uid(pool).to_inner();
    let uid = borrow_uid_mut(pool);
    if (df::exists(uid, ScallopPoolKey())) {
        let pos: &mut ScallopPosition = df::borrow_mut(uid, ScallopPoolKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, ScallopPoolKey(), ScallopPosition { deposited_value: amount });
    };

    event::emit(ScallopDeposited { object_id: pool_id, amount });
}

public(package) fun pool_withdraw_scallop<T>(
    pool: &StreamPool<T>,
    registry: &ProtocolRegistry,
    _config: &ProtocolConfig,
    amount: u64,
    _ctx: &TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);

    let oid = borrow_uid(pool).to_inner();
    event::emit(ScallopWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}

public fun vault_invest_scallop<T>(
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
    if (df::exists(buid, ScallopVaultKey())) {
        let pos: &mut ScallopPosition = df::borrow_mut(buid, ScallopVaultKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, ScallopVaultKey(), ScallopPosition { deposited_value: amount });
    };

    event::emit(ScallopDeposited { object_id: vault_id, amount });
}

public fun vault_withdraw_scallop<T>(
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
    event::emit(ScallopWithdrawn { object_id: oid, gross: amount, fee: 0, net: amount });
}
