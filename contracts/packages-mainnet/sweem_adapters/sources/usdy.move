/// Ondo USDY yield adapter for Sweem (yield_type Y = 1).
///
/// USDY has NO on-chain mint/redeem on Sui — it can only be acquired/disposed by a
/// DEX swap. We deliberately keep that swap OFF-CHAIN (frontend/PTB via the Cetus
/// aggregator, with its own `min_out`), so this adapter has ZERO external-protocol
/// dependency and lives in the main `sweem_adapters` package. It only custodies an
/// already-swapped `Coin<Y>` (USDY) and tracks the base-token (T, e.g. USDC) principal.
///
/// Because USDY changes denomination (T -> Y), the clean "same-token receipt" model of
/// scallop/suilend does NOT apply. Each direction is a TWO-STEP round-trip:
///
///   invest:   extract -> (UI swaps T->Y) -> deposit
///   withdraw: extract -> (UI swaps Y->T) -> deposit
///
/// The `extract` half hands base/yield coins to the caller for the UI swap; the matching
/// `deposit` half takes the swapped coins back in. To make this atomic and un-gameable,
/// each `extract` returns a HOT-POTATO receipt (a struct with NO abilities: it cannot be
/// copied, dropped, stored, or transferred) that can ONLY be consumed by the paired
/// `deposit` function in the SAME programmable transaction block. The receipt binds the
/// exact pool/vault id (+ amount / principal slice) so a malicious PTB cannot pair an
/// extract from object A with a deposit to object B, or under-deposit.
///
/// Generic over `Y` (the yield-bearing coin, supplied by callers as a type arg — e.g.
/// USDY). The module does NOT import the USDY coin package, keeping `sweem_adapters`
/// dependency-free. The org/employee pass the concrete `Y` (and the base token `T`).
///
/// NO `cover_claim_from_usdy`: a claim needs idle `T` in `pool.balance`, and a USDY
/// position can't be auto-converted to T on-chain (no on-chain swap). The org MUST
/// unwind a USDY pool position (extract -> swap -> deposit round-trip) BEFORE a claim
/// needs that liquidity. There is intentionally no cover_claim entry that can't deliver T.
module sweem_adapters::usdy;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::coin::{Self, Coin};
use sui::event;

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
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"usdy";

#[error] const ENotOrg: vector<u8> = b"Caller is not the org";
#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"USDY not approved in registry";
#[error] const ENoPosition: vector<u8> = b"No USDY position on this pool";
#[error] const ENoVaultPosition: vector<u8> = b"No USDY position on this vault bucket";
#[error] const EReceiptMismatch: vector<u8> = b"Receipt does not bind this pool/vault";
#[error] const EInsufficientPosition: vector<u8> = b"Requested USDY exceeds the custodied position";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";

// Coin<Y> (USDY) is key+store -> stored via dof.
// UsdyPosition is store-only -> stored via df.
public struct UsdyPoolKey() has copy, drop, store;
public struct UsdyVaultKey() has copy, drop, store;
public struct UsdyPoolPositionKey() has copy, drop, store;
public struct UsdyVaultPositionKey() has copy, drop, store;

// Principal recorded in BASE-TOKEN (T) units — the value swapped IN, not the USDY held.
public struct UsdyPosition has store {
    deposited_value: u64,
}

// ── Hot-potato receipts: NO abilities (cannot copy/drop/store/transfer) ──────────────
// The ONLY way to discharge a receipt is the paired `*_deposit` function below, which
// asserts the bound id matches the object it is depositing into. This forces the
// extract->swap->deposit round-trip to complete atomically in one PTB.

// Returned by `*_invest_*_extract`: binds the pool/vault that handed out base token T
// for the swap, and `amount` (T principal) to record on the matching deposit.
public struct UsdyInvestReceipt {
    // Pool id (pool side) or vault id (vault side) that the extract came from.
    bound_id: ID,
    // Base-token (T) principal extracted — recorded into UsdyPosition on deposit.
    amount: u64,
    // Vault side only: which bucket to deposit back into. Empty string on the pool side.
    token_name: String,
}

// Returned by `*_withdraw_*_extract`: binds the pool/vault that handed out `Coin<Y>`
// for the swap-back, and the principal slice being unwound (pro-rated by Y fraction).
public struct UsdyWithdrawReceipt {
    bound_id: ID,
    // Base-token (T) principal slice being unwound — used to size yield on deposit.
    principal_slice: u64,
    // Vault side only: which bucket to deposit the recovered T back into.
    token_name: String,
}

public struct UsdyInvested has copy, drop { object_id: ID, amount: u64 }
public struct UsdyReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// ════════════════════════════════════════════════════════════════════════════════════
// POOL SIDE (org). Y is allowed for orgs (yield-stablecoin strategy).
// ════════════════════════════════════════════════════════════════════════════════════

/// Step 1 of pool invest. Org-gated. Pulls `amount` of base token T out of the pool's
/// idle balance (coverage floor enforced by `split_balance_for_invest`) and returns it
/// as a `Coin<T>` for the UI to swap into USDY, plus a hot-potato receipt binding this
/// pool + amount. The org CANNOT walk away with the T: the receipt has no abilities and
/// can only be consumed by `pool_invest_usdy_deposit` in the same PTB, which requires the
/// swapped `Coin<Y>` to be stored.
public fun pool_invest_usdy_extract<T>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);

    let bound_id = borrow_uid(pool).to_inner();
    // split_balance_for_invest is itself org-gated and enforces the coverage floor.
    let base_coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);

    (base_coin, UsdyInvestReceipt { bound_id, amount, token_name: std::string::utf8(b"") })
}

/// Step 2 of pool invest. Consumes the receipt from `pool_invest_usdy_extract`, stores
/// the swapped `Coin<Y>` (USDY) under the pool DOF, and records `receipt.amount` (base
/// token T principal) into the pool's UsdyPosition. Aborts unless the receipt binds THIS
/// pool. Consuming the receipt is the ONLY way to discharge it, so the round-trip is
/// atomic — there is no path that releases the extracted T without USDY being custodied.
public fun pool_invest_usdy_deposit<T, Y>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    yielded: Coin<Y>,
    receipt: UsdyInvestReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);

    let UsdyInvestReceipt { bound_id, amount, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), EReceiptMismatch);

    let uid = borrow_uid_mut(pool, ctx);
    if (dof::exists(uid, UsdyPoolKey())) {
        let existing: &mut Coin<Y> = dof::borrow_mut(uid, UsdyPoolKey());
        existing.join(yielded);
    } else {
        dof::add(uid, UsdyPoolKey(), yielded);
    };

    if (df::exists(uid, UsdyPoolPositionKey())) {
        let pos: &mut UsdyPosition = df::borrow_mut(uid, UsdyPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, UsdyPoolPositionKey(), UsdyPosition { deposited_value: amount });
    };

    event::emit(UsdyInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

/// Step 1 of pool withdraw. Org-gated. Splits `amount_y` of the custodied `Coin<Y>`
/// (USDY) out for the UI to swap back to T, and returns a receipt recording the pool id
/// plus the principal slice being unwound. The principal slice is pro-rated by the USDY
/// fraction swapped out (`amount_y / total_y`), rounding UP so yield is never overcounted
/// (mirrors `scallop` partial-redeem math). Position is decremented here so the custodied
/// state stays consistent even before the deposit half completes; the receipt forces the
/// deposit half to run and return the recovered T into the pool.
public fun pool_withdraw_usdy_extract<T, Y>(
    pool: &mut StreamPool<T>,
    registry: &ProtocolRegistry,
    amount_y: u64,
    ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    assert!(dof::exists(borrow_uid(pool), UsdyPoolKey()), ENoPosition);

    let bound_id = borrow_uid(pool).to_inner();
    let total_y = dof::borrow<UsdyPoolKey, Coin<Y>>(borrow_uid(pool), UsdyPoolKey()).value();
    assert!(amount_y <= total_y, EInsufficientPosition);

    let deposited_value = df::borrow<UsdyPoolPositionKey, UsdyPosition>(
        borrow_uid(pool), UsdyPoolPositionKey(),
    ).deposited_value;

    let is_full = amount_y == total_y;
    let principal_slice = pro_rate_principal(deposited_value, amount_y, total_y, is_full);

    // Split off the USDY for the UI to swap (org-gated uid via borrow_uid_mut).
    let y_coin = if (is_full) {
        dof::remove<UsdyPoolKey, Coin<Y>>(borrow_uid_mut(pool, ctx), UsdyPoolKey())
    } else {
        let stored: &mut Coin<Y> = dof::borrow_mut(borrow_uid_mut(pool, ctx), UsdyPoolKey());
        stored.split(amount_y, ctx)
    };

    // Decrement the principal now; deposit half computes yield against `principal_slice`.
    if (is_full) {
        let UsdyPosition { deposited_value: _ } = df::remove(
            borrow_uid_mut(pool, ctx), UsdyPoolPositionKey()
        );
    } else {
        let pos: &mut UsdyPosition = df::borrow_mut(borrow_uid_mut(pool, ctx), UsdyPoolPositionKey());
        pos.deposited_value = if (deposited_value > principal_slice) {
            deposited_value - principal_slice
        } else { 0 };
    };

    (y_coin, UsdyWithdrawReceipt { bound_id, principal_slice, token_name: std::string::utf8(b"") })
}

/// Step 2 of pool withdraw. Consumes the `pool_withdraw_usdy_extract` receipt, takes the
/// `Coin<T>` recovered from the UI swap-back, captures the USDY yield fee (this is where
/// the protocol realizes a Y yield fee), and merges the remainder back into the pool's
/// idle balance. `yield = max(0, recovered - principal_slice)`; `fee = floor(yield *
/// org_yield_fee_bps / 10_000)` -> treasury. Aborts unless the receipt binds THIS pool.
public fun pool_withdraw_usdy_deposit<T>(
    pool: &mut StreamPool<T>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    recovered: Coin<T>,
    receipt: UsdyWithdrawReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);

    let UsdyWithdrawReceipt { bound_id, principal_slice, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), EReceiptMismatch);

    let gross = recovered.value();
    let fee = compute_yield_fee(gross, principal_slice, org_yield_fee_bps(config));

    let mut recovered = recovered;
    if (fee > 0) {
        transfer::public_transfer(recovered.split(fee, ctx), treasury(config));
    };
    // Registry-gated uid: this is a not-org-initiated yield return path consistent with
    // the other adapters, though here the org IS the caller (extract was org-gated).
    let _ = borrow_uid_mut_yield(pool, registry);
    merge_balance_from_yield(pool, recovered.into_balance());

    event::emit(UsdyReturned {
        object_id: borrow_uid(pool).to_inner(),
        gross, yield_fee: fee, net: gross - fee,
    });
}

// ════════════════════════════════════════════════════════════════════════════════════
// VAULT SIDE (employee). Mirrors the pool side with employee_vault helpers.
// ════════════════════════════════════════════════════════════════════════════════════

/// Step 1 of vault invest. Owner-gated. Pulls `amount` of base token T out of the vault
/// bucket and returns it as `Coin<T>` for the UI to swap into USDY, plus a receipt
/// binding this vault + bucket + amount. Discharged only by `vault_invest_usdy_deposit`.
public fun vault_invest_usdy_extract<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let bound_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    let base_coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);

    (base_coin, UsdyInvestReceipt { bound_id, amount, token_name })
}

/// Step 2 of vault invest. Consumes the receipt, stores the swapped `Coin<Y>` under the
/// bucket DOF, and records the T principal into the bucket's UsdyPosition. Aborts unless
/// the receipt binds THIS vault.
public fun vault_invest_usdy_deposit<T, Y>(
    vault: &mut EmployeeVault,
    registry: &ProtocolRegistry,
    yielded: Coin<Y>,
    receipt: UsdyInvestReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let UsdyInvestReceipt { bound_id, amount, token_name } = receipt;
    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    assert!(bound_id == vault_id, EReceiptMismatch);

    let bucket = borrow_bucket_mut<T>(vault, token_name);
    let buid = bucket_uid_mut(bucket, registry);
    if (dof::exists(buid, UsdyVaultKey())) {
        let existing: &mut Coin<Y> = dof::borrow_mut(buid, UsdyVaultKey());
        existing.join(yielded);
    } else {
        dof::add(buid, UsdyVaultKey(), yielded);
    };

    if (df::exists(buid, UsdyVaultPositionKey())) {
        let pos: &mut UsdyPosition = df::borrow_mut(buid, UsdyVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, UsdyVaultPositionKey(), UsdyPosition { deposited_value: amount });
    };

    event::emit(UsdyInvested { object_id: vault_id, amount });
}

/// Step 1 of vault withdraw. Owner-gated. Splits `amount_y` of the bucket's custodied
/// `Coin<Y>` out for the UI to swap back to T, decrements the pro-rated principal, and
/// returns a receipt binding this vault + bucket + principal slice. Same pro-rate /
/// round-up rule as the pool side.
public fun vault_withdraw_usdy_extract<T, Y>(
    vault: &mut EmployeeVault,
    token_name: String,
    registry: &ProtocolRegistry,
    amount_y: u64,
    ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let bound_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), UsdyVaultKey()), ENoVaultPosition);

    let total_y = dof::borrow<UsdyVaultKey, Coin<Y>>(
        bucket_uid_mut(bucket, registry), UsdyVaultKey()
    ).value();
    assert!(amount_y <= total_y, EInsufficientPosition);

    let deposited_value = df::borrow<UsdyVaultPositionKey, UsdyPosition>(
        bucket_uid_mut(bucket, registry), UsdyVaultPositionKey(),
    ).deposited_value;

    let is_full = amount_y == total_y;
    let principal_slice = pro_rate_principal(deposited_value, amount_y, total_y, is_full);

    let y_coin = if (is_full) {
        dof::remove<UsdyVaultKey, Coin<Y>>(bucket_uid_mut(bucket, registry), UsdyVaultKey())
    } else {
        let stored: &mut Coin<Y> = dof::borrow_mut(bucket_uid_mut(bucket, registry), UsdyVaultKey());
        stored.split(amount_y, ctx)
    };

    if (is_full) {
        let UsdyPosition { deposited_value: _ } = df::remove(
            bucket_uid_mut(bucket, registry), UsdyVaultPositionKey()
        );
    } else {
        let pos: &mut UsdyPosition = df::borrow_mut(
            bucket_uid_mut(bucket, registry), UsdyVaultPositionKey()
        );
        pos.deposited_value = if (deposited_value > principal_slice) {
            deposited_value - principal_slice
        } else { 0 };
    };

    (y_coin, UsdyWithdrawReceipt { bound_id, principal_slice, token_name })
}

/// Step 2 of vault withdraw. Consumes the receipt, captures the vault yield fee, and
/// merges the recovered T back into the bucket. `yield = max(0, recovered -
/// principal_slice)`; `fee = floor(yield * vault_yield_fee_bps / 10_000)` -> treasury.
public fun vault_withdraw_usdy_deposit<T>(
    vault: &mut EmployeeVault,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    recovered: Coin<T>,
    receipt: UsdyWithdrawReceipt,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let UsdyWithdrawReceipt { bound_id, principal_slice, token_name } = receipt;
    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    assert!(bound_id == vault_id, EReceiptMismatch);

    let gross = recovered.value();
    let fee = compute_yield_fee(gross, principal_slice, vault_yield_fee_bps(config));

    let mut recovered = recovered;
    if (fee > 0) {
        transfer::public_transfer(recovered.split(fee, ctx), treasury(config));
    };
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    merge_bucket_from_yield(bucket, recovered.into_balance());

    event::emit(UsdyReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}

// ── pure helpers (unit-testable without any live object) ─────────────────────────────

/// Pro-rate the base-token principal by the USDY fraction being unwound. Rounds UP so we
/// never overcount yield earned (the fee is taken on `gross - principal_slice`). A full
/// unwind returns the entire recorded principal.
public(package) fun pro_rate_principal(
    deposited_value: u64,
    amount_y: u64,
    total_y: u64,
    is_full: bool,
): u64 {
    if (is_full) return deposited_value;
    oz_u128::mul_div(
        deposited_value as u128,
        amount_y as u128,
        total_y as u128,
        rounding::up(),
    ).destroy_or!(abort EArithmeticOverflow) as u64
}

/// fee = floor((gross - principal) * fee_bps / 10_000), 0 if no yield.
public(package) fun compute_yield_fee(gross: u64, principal: u64, fee_bps: u64): u64 {
    let yield_earned = if (gross > principal) { gross - principal } else { 0 };
    oz_u64::mul_div(yield_earned, fee_bps, 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow)
}

#[test_only]
public fun protocol_name(): vector<u8> { PROTOCOL_NAME }

// ── test-only gate mirrors + ungated round-trip plumbing ─────────────────────────────
// The mainnet `sweem_registry` exposes no helper to construct an APPROVED registry
// without naming `AccessControl`. `AccessControl` is only a TRANSITIVE dep of
// `sweem_adapters` (via `sweem_registry`), so it cannot be imported into a test here
// without adding `openzeppelin_access` to `sweem_adapters/Move.toml` — explicitly out of
// scope for this change. To keep the test suite dependency-free while still covering the
// security-critical receipt model, these helpers expose:
//   (a) the entry-gate asserts (approval / org / owner) so each predicate is unit-tested;
//   (b) UNGATED round-trip plumbing (extract/deposit minus the registry+auth asserts) so
//       receipt id-binding, DOF/DF storage, principal pro-rate, and yield merge are tested
//       end-to-end. The gated public fns wrap exactly this plumbing behind the asserts
//       in (a), so together these give full coverage; the gated public fns themselves are
//       exercised on the mainnet e2e once `usdy` is approved in the registry.

#[test_only]
public fun assert_approved_for_test(registry: &ProtocolRegistry) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
}

#[test_only]
public fun assert_pool_org_for_test<T>(pool: &StreamPool<T>, ctx: &TxContext) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
}

#[test_only]
public fun assert_vault_owner_for_test(vault: &EmployeeVault, ctx: &TxContext) {
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);
}

// Ungated pool invest extract: pulls T from idle balance + builds the receipt. Mirrors
// `pool_invest_usdy_extract` minus the approval/org asserts.
#[test_only]
public fun pool_invest_extract_unchecked<T>(
    pool: &mut StreamPool<T>,
    amount: u64,
    ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt) {
    let bound_id = borrow_uid(pool).to_inner();
    let base_coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);
    (base_coin, UsdyInvestReceipt { bound_id, amount, token_name: std::string::utf8(b"") })
}

// Ungated pool invest deposit: consumes the receipt, stores Coin<Y>, records principal.
// Mirrors `pool_invest_usdy_deposit` minus the approval/org asserts. Keeps the
// receipt-id binding assert (the security check under test).
#[test_only]
public fun pool_invest_deposit_unchecked<T, Y>(
    pool: &mut StreamPool<T>,
    yielded: Coin<Y>,
    receipt: UsdyInvestReceipt,
    ctx: &mut TxContext,
) {
    let UsdyInvestReceipt { bound_id, amount, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), EReceiptMismatch);
    let uid = borrow_uid_mut(pool, ctx);
    if (dof::exists(uid, UsdyPoolKey())) {
        let existing: &mut Coin<Y> = dof::borrow_mut(uid, UsdyPoolKey());
        existing.join(yielded);
    } else {
        dof::add(uid, UsdyPoolKey(), yielded);
    };
    if (df::exists(uid, UsdyPoolPositionKey())) {
        let pos: &mut UsdyPosition = df::borrow_mut(uid, UsdyPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, UsdyPoolPositionKey(), UsdyPosition { deposited_value: amount });
    };
}

// Ungated pool withdraw extract: splits Coin<Y> out, pro-rates + decrements principal,
// returns the withdraw receipt. Mirrors `pool_withdraw_usdy_extract` minus the asserts.
#[test_only]
public fun pool_withdraw_extract_unchecked<T, Y>(
    pool: &mut StreamPool<T>,
    amount_y: u64,
    ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt) {
    let bound_id = borrow_uid(pool).to_inner();
    let total_y = dof::borrow<UsdyPoolKey, Coin<Y>>(borrow_uid(pool), UsdyPoolKey()).value();
    assert!(amount_y <= total_y, EInsufficientPosition);
    let deposited_value = df::borrow<UsdyPoolPositionKey, UsdyPosition>(
        borrow_uid(pool), UsdyPoolPositionKey(),
    ).deposited_value;
    let is_full = amount_y == total_y;
    let principal_slice = pro_rate_principal(deposited_value, amount_y, total_y, is_full);
    let y_coin = if (is_full) {
        dof::remove<UsdyPoolKey, Coin<Y>>(borrow_uid_mut(pool, ctx), UsdyPoolKey())
    } else {
        let stored: &mut Coin<Y> = dof::borrow_mut(borrow_uid_mut(pool, ctx), UsdyPoolKey());
        stored.split(amount_y, ctx)
    };
    if (is_full) {
        let UsdyPosition { deposited_value: _ } = df::remove(
            borrow_uid_mut(pool, ctx), UsdyPoolPositionKey()
        );
    } else {
        let pos: &mut UsdyPosition = df::borrow_mut(borrow_uid_mut(pool, ctx), UsdyPoolPositionKey());
        pos.deposited_value = if (deposited_value > principal_slice) {
            deposited_value - principal_slice
        } else { 0 };
    };
    (y_coin, UsdyWithdrawReceipt { bound_id, principal_slice, token_name: std::string::utf8(b"") })
}

// Ungated pool withdraw deposit: consumes withdraw receipt, takes the fee, merges the
// rest. Mirrors `pool_withdraw_usdy_deposit` minus the approval assert. Keeps the
// receipt-id binding assert.
#[test_only]
public fun pool_withdraw_deposit_unchecked<T>(
    pool: &mut StreamPool<T>,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    recovered: Coin<T>,
    receipt: UsdyWithdrawReceipt,
    ctx: &mut TxContext,
) {
    let UsdyWithdrawReceipt { bound_id, principal_slice, token_name: _ } = receipt;
    assert!(bound_id == borrow_uid(pool).to_inner(), EReceiptMismatch);
    let gross = recovered.value();
    let fee = compute_yield_fee(gross, principal_slice, org_yield_fee_bps(config));
    let mut recovered = recovered;
    if (fee > 0) {
        transfer::public_transfer(recovered.split(fee, ctx), treasury(config));
    };
    let _ = borrow_uid_mut_yield(pool, registry);
    merge_balance_from_yield(pool, recovered.into_balance());
}

// Read the custodied USDY position value (Coin<Y> held in the pool DOF), 0 if none.
#[test_only]
public fun pool_position_y_value<T, Y>(pool: &StreamPool<T>): u64 {
    if (!dof::exists(borrow_uid(pool), UsdyPoolKey())) return 0;
    dof::borrow<UsdyPoolKey, Coin<Y>>(borrow_uid(pool), UsdyPoolKey()).value()
}
