/// Testnet STUB of the USDY yield adapter (yield_type Y = 1).
///
/// Mirrors the public API SHAPE of the mainnet `sweem_adapters::usdy` so the frontend can
/// build/type-check the same extract->swap->deposit PTBs against the testnet package. The
/// testnet `sweem_core` has no fund-movement helpers, so these are dependency-free no-ops:
/// they enforce the same auth gates, carry the same hot-potato receipts (so the round-trip
/// is still atomic and id-bound), emit events, and route any caller-supplied coins back to
/// the sender instead of custodying them. No real yield/principal accounting.
module sweem_adapters::usdy;

use sui::coin::{Self, Coin};
use sui::event;
use sweem_core::stream_pool::{Self, StreamPool, borrow_uid};
use sweem_core::employee_vault::{Self as employee_vault, EmployeeVault, vault_uid_mut};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig, is_approved};
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"usdy";

// Hot-potato receipts: NO abilities, same as mainnet. Only the paired deposit can consume.
public struct UsdyInvestReceipt { bound_id: ID, amount: u64, token_name: String }
public struct UsdyWithdrawReceipt { bound_id: ID, principal_slice: u64, token_name: String }

public struct UsdyInvested has copy, drop { object_id: ID, amount: u64 }
public struct UsdyReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// ── pool side (org) ──────────────────────────────────────────────────────────────────

public fun pool_invest_usdy_extract<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);
    let bound_id = borrow_uid(pool).to_inner();
    // Stub: no real balance to split — hand back a zero coin; the receipt still binds.
    (coin::zero<T>(ctx), UsdyInvestReceipt { bound_id, amount, token_name: std::string::utf8(b"") })
}

public fun pool_invest_usdy_deposit<T, Y>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    yielded: Coin<Y>,
    receipt: UsdyInvestReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);
    let UsdyInvestReceipt { bound_id, amount, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), 2);
    // Stub: return the supplied USDY to the caller instead of custodying it.
    transfer::public_transfer(yielded, ctx.sender());
    event::emit(UsdyInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

public fun pool_withdraw_usdy_extract<T, Y>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount_y: u64,
    ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(stream_pool::org(pool) == ctx.sender(), 1);
    let bound_id = borrow_uid(pool).to_inner();
    (coin::zero<Y>(ctx), UsdyWithdrawReceipt { bound_id, principal_slice: amount_y, token_name: std::string::utf8(b"") })
}

public fun pool_withdraw_usdy_deposit<T>(
    pool: &mut StreamPool<T>,
    _config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    recovered: Coin<T>,
    receipt: UsdyWithdrawReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    let UsdyWithdrawReceipt { bound_id, principal_slice, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), 2);
    let gross = recovered.value();
    transfer::public_transfer(recovered, ctx.sender());
    event::emit(UsdyReturned {
        object_id: borrow_uid(pool).to_inner(), gross, yield_fee: 0, net: gross,
    });
    let _ = principal_slice;
}

// ── vault side (employee) ────────────────────────────────────────────────────────────

public fun vault_invest_usdy_extract<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);
    let bound_id = vault_uid_mut(vault).to_inner();
    (coin::zero<T>(ctx), UsdyInvestReceipt { bound_id, amount, token_name })
}

public fun vault_invest_usdy_deposit<T, Y>(
    vault: &mut EmployeeVault,
    registry: &ProtocolRegistry,
    yielded: Coin<Y>,
    receipt: UsdyInvestReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);
    let UsdyInvestReceipt { bound_id, amount, token_name: _ } = receipt;
    let vault_id = vault_uid_mut(vault).to_inner();
    assert!(bound_id == vault_id, 2);
    transfer::public_transfer(yielded, ctx.sender());
    event::emit(UsdyInvested { object_id: vault_id, amount });
}

public fun vault_withdraw_usdy_extract<T, Y>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount_y: u64,
    ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);
    let bound_id = vault_uid_mut(vault).to_inner();
    (coin::zero<Y>(ctx), UsdyWithdrawReceipt { bound_id, principal_slice: amount_y, token_name })
}

public fun vault_withdraw_usdy_deposit<T>(
    vault: &mut EmployeeVault,
    _config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    recovered: Coin<T>,
    receipt: UsdyWithdrawReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), 0);
    assert!(employee_vault::owner(vault) == ctx.sender(), 1);
    let UsdyWithdrawReceipt { bound_id, principal_slice, token_name: _ } = receipt;
    let vault_id = vault_uid_mut(vault).to_inner();
    assert!(bound_id == vault_id, 2);
    let gross = recovered.value();
    transfer::public_transfer(recovered, ctx.sender());
    event::emit(UsdyReturned { object_id: vault_id, gross, yield_fee: 0, net: gross });
    let _ = principal_slice;
}
