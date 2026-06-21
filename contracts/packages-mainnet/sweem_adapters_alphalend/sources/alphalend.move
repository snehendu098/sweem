/// AlphaFi AlphaLend lending yield adapter for Sweem (yield_type L = 0).
///
/// FULL adapter API (pool + vault + employee-claim + org-rebalance), mirroring
/// `sweem_adapters::navi`. AlphaLend is a lending market (L), so org payroll pool
/// funds MAY use it. The generic coin type `C` is the supplied collateral coin
/// (e.g. USDC = market_id 6, USDT = 5; SUI = 1 needs the SUI fulfill variant —
/// see note on `pool_withdraw_alphalend`).
///
/// MODEL (verified against on-chain bytecode of pkg
/// 0xee754fc0c6d977403c9218cedbfffed033b4b42b50a65c2c3f1c7be13efeafd2 and the
/// AlphaFiTech/alphalend-contracts-interfaces source):
///   - `create_position(&mut LendingProtocol, ctx): PositionCap` — one cap per
///     position; a single Position holds collateral across MANY markets, so the
///     pool/vault keeps ONE PositionCap (stored via dof) regardless of coin type.
///   - supply:   `add_collateral<C>(&mut protocol, &cap, market_id, Coin<C>, &clock, ctx)`
///   - withdraw: `remove_collateral<C>(&mut protocol, &cap, market_id, amount, &clock)
///               : LiquidityPromise<C>` (HOT POTATO) then
///               `fulfill_promise<C>(&mut protocol, promise, &clock, ctx): Coin<C>`.
///     The promise is created AND fulfilled inside each withdraw fn here — it never
///     escapes. (`fulfill_promise_SUI` is the SUI-only variant; this generic adapter
///     uses the non-SUI `fulfill_promise`, so do NOT use it for the raw SUI market.)
///
/// PRICE REFRESH (IMPORTANT for the PTB the caller builds):
///   `remove_collateral` reads the oracle embedded in `LendingProtocol` and aborts
///   on a stale price. Every withdraw PTB MUST prepend, for the withdrawn coin `C`:
///     1. `<oracle_pkg>::oracle::update_price_from_pyth(AlphaFiOracle, PriceInfoObject<C>, Clock)`
///     2. `let ti = 0x1::type_name::get<C>()`
///     3. `let pi = <oracle_pkg>::oracle::get_price_info(AlphaFiOracle, ti)`
///     4. `0xee75..::alpha_lending::update_price(LendingProtocol, pi)`
///   then call this adapter's withdraw fn. The refresh is a SEPARATE moveCall chain;
///   this adapter takes NO oracle argument (unlike Navi) because `remove_collateral`
///   consumes the already-refreshed oracle inside `LendingProtocol`.
///
/// YIELD MODEL: AlphaLend uses an interest-bearing XToken share model — supplied
/// collateral grows in underlying terms as interest accrues. On withdrawal of
/// `amount`, `gross ~= amount`; realized yield surfaces as `gross - principal_share`
/// where `principal_share = min(amount, deposited_value)`. Identical accounting to
/// the Navi aToken adapter: the yield fee is collected primarily on full exit.
module sweem_adapters_alphalend::alphalend;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::event;

use alpha_lending::alpha_lending::{
    LendingProtocol,
    create_position,
    add_collateral,
    remove_collateral,
    fulfill_promise,
};
use alpha_lending::position::PositionCap;

use sweem_core::stream_pool::{
    Self as stream_pool, StreamPool,
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

const PROTOCOL_NAME: vector<u8> = b"alphalend";

#[error] const ENotOrg: vector<u8> = b"Caller is not the org";
#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"AlphaLend not approved in registry";
#[error] const ENoPositionCap: vector<u8> = b"No PositionCap on pool - call store_pool_position_cap first";
#[error] const ENoVaultPositionCap: vector<u8> = b"No PositionCap on vault - call store_vault_position_cap first";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";

// PositionCap is key+store -> stored via dof.
// AlphalendPosition is store-only -> stored via df. One PositionCap manages a
// single AlphaLend Position that may hold multiple coin markets, so one cap per
// pool / per vault-bucket is sufficient. `deposited_value` tracks principal for
// the coin type of the bucket / pool it lives on.
public struct AlphalendPoolCapKey() has copy, drop, store;
public struct AlphalendVaultCapKey() has copy, drop, store;
public struct AlphalendPoolPositionKey() has copy, drop, store;
public struct AlphalendVaultPositionKey() has copy, drop, store;

public struct AlphalendPosition has store {
    deposited_value: u64,
}

public struct AlphalendInvested has copy, drop { object_id: ID, amount: u64 }
public struct AlphalendReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// ---- One-time setup: create + store a PositionCap ----

// Org creates an AlphaLend Position and stores its PositionCap into the pool once
// at setup. Mirrors navi's `store_pool_account_cap`, but the cap is minted here via
// AlphaLend's `create_position` rather than supplied by the caller.
public fun store_pool_position_cap<T>(
    pool: &mut StreamPool<T>,
    protocol: &mut LendingProtocol,
    ctx: &mut TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    let cap = create_position(protocol, ctx);
    dof::add(borrow_uid_mut(pool, ctx), AlphalendPoolCapKey(), cap);
}

// Employee creates an AlphaLend Position and stores its PositionCap into their
// vault once at setup. Mirrors navi's `store_vault_account_cap`.
public fun store_vault_position_cap(
    vault: &mut EmployeeVault,
    protocol: &mut LendingProtocol,
    ctx: &mut TxContext,
) {
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);
    let cap = create_position(protocol, ctx);
    dof::add(vault_uid_mut(vault, ctx), AlphalendVaultCapKey(), cap);
}

// ---- Pool side (org payroll funds) ----

// Org moves idle pool balance into AlphaLend to earn supply yield.
public fun pool_invest_alphalend<T>(
    pool: &mut StreamPool<T>,
    protocol: &mut LendingProtocol,
    registry: &ProtocolRegistry,
    clock: &Clock,
    market_id: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    assert!(dof::exists(borrow_uid(pool), AlphalendPoolCapKey()), ENoPositionCap);

    let coin = coin::from_balance(split_balance_for_invest(pool, amount, ctx), ctx);
    {
        let cap: &PositionCap = dof::borrow(borrow_uid(pool), AlphalendPoolCapKey());
        add_collateral<T>(protocol, cap, market_id, coin, clock, ctx);
    };

    let uid = borrow_uid_mut(pool, ctx);
    if (df::exists(uid, AlphalendPoolPositionKey())) {
        let pos: &mut AlphalendPosition = df::borrow_mut(uid, AlphalendPoolPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(uid, AlphalendPoolPositionKey(), AlphalendPosition { deposited_value: amount });
    };

    event::emit(AlphalendInvested { object_id: borrow_uid(pool).to_inner(), amount });
}

// Withdraws `amount` of underlying from AlphaLend back into the pool, deducting the
// org yield fee. `public(package)` — invoked by `cover_claim_from_alphalend` (on
// behalf of an employee claim) and `org_withdraw_alphalend` (org rebalance).
//
// HOT POTATO: `remove_collateral` returns a `LiquidityPromise<T>` that is fulfilled
// here via `fulfill_promise<T>` in the same call — it never escapes this function.
// PRICE REFRESH for `T` must be done earlier in the PTB (see module doc).
public(package) fun pool_withdraw_alphalend<T>(
    pool: &mut StreamPool<T>,
    protocol: &mut LendingProtocol,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    market_id: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(dof::exists(borrow_uid(pool), AlphalendPoolCapKey()), ENoPositionCap);

    // Remove collateral (returns hot potato) then fulfill it for a Coin<T>.
    let gross_coin: Coin<T> = {
        let cap: &PositionCap = dof::borrow(borrow_uid_mut_yield(pool, registry), AlphalendPoolCapKey());
        let promise = remove_collateral<T>(protocol, cap, market_id, amount, clock);
        fulfill_promise<T>(protocol, promise, clock, ctx)
    };
    let gross = gross_coin.value();

    let pos_deposited = df::borrow<AlphalendPoolPositionKey, AlphalendPosition>(
        borrow_uid(pool), AlphalendPoolPositionKey(),
    ).deposited_value;

    let principal_share = if (amount <= pos_deposited) { amount } else { pos_deposited };
    let fee = compute_yield_fee(gross, principal_share, org_yield_fee_bps(config));

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_balance_from_yield(pool, gross_coin.into_balance());

    let pos: &mut AlphalendPosition = df::borrow_mut(borrow_uid_mut_yield(pool, registry), AlphalendPoolPositionKey());
    pos.deposited_value = pos_deposited - principal_share;

    event::emit(AlphalendReturned {
        object_id: borrow_uid(pool).to_inner(),
        gross, yield_fee: fee, net: gross - fee,
    });
}

// ---- Vault side (employee claimed funds) ----

// Employee moves claimed tokens from their vault bucket into AlphaLend.
public fun vault_invest_alphalend<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    protocol: &mut LendingProtocol,
    registry: &ProtocolRegistry,
    clock: &Clock,
    market_id: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), AlphalendVaultCapKey()), ENoVaultPositionCap);

    let coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);
    {
        let cap: &PositionCap = dof::borrow(bucket_uid_mut(bucket, registry), AlphalendVaultCapKey());
        add_collateral<T>(protocol, cap, market_id, coin, clock, ctx);
    };

    let buid = bucket_uid_mut(bucket, registry);
    if (df::exists(buid, AlphalendVaultPositionKey())) {
        let pos: &mut AlphalendPosition = df::borrow_mut(buid, AlphalendVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, AlphalendVaultPositionKey(), AlphalendPosition { deposited_value: amount });
    };

    event::emit(AlphalendInvested { object_id: vault_id, amount });
}

// Employee withdraws `amount` of their AlphaLend position back into their vault
// bucket. PRICE REFRESH for `T` must be done earlier in the PTB (see module doc).
public fun vault_withdraw_alphalend<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    protocol: &mut LendingProtocol,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    market_id: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<T>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), AlphalendVaultCapKey()), ENoVaultPositionCap);

    // Remove collateral + fulfill promise in a block so cap + buid drop before merge.
    let gross_coin: Coin<T> = {
        let cap: &PositionCap = dof::borrow(bucket_uid_mut(bucket, registry), AlphalendVaultCapKey());
        let promise = remove_collateral<T>(protocol, cap, market_id, amount, clock);
        fulfill_promise<T>(protocol, promise, clock, ctx)
    };
    let gross = gross_coin.value();

    let pos_deposited = df::borrow<AlphalendVaultPositionKey, AlphalendPosition>(
        bucket_uid_mut(bucket, registry), AlphalendVaultPositionKey(),
    ).deposited_value;

    let principal_share = if (amount <= pos_deposited) { amount } else { pos_deposited };
    let fee = compute_yield_fee(gross, principal_share, vault_yield_fee_bps(config));

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_bucket_from_yield(bucket, gross_coin.into_balance());

    let pos: &mut AlphalendPosition = df::borrow_mut(bucket_uid_mut(bucket, registry), AlphalendVaultPositionKey());
    pos.deposited_value = pos_deposited - principal_share;

    event::emit(AlphalendReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}

// ---- External PTB entry points ----

// Employee-side claim helper for a pool split across multiple protocols. Pulls up to
// `max_amount` of the CALLER'S OWN claim shortfall out of AlphaLend into the pool's
// idle balance, then returns (it does NOT claim). Compose in a PTB with the price
// refresh (see module doc), any other `cover_claim_from_*` calls, and a final
// `stream_pool::claim`. Safe to be public: the draw is bounded by the caller's own
// claimable, so non-employees and over-draws are no-ops — no grief vector.
public fun cover_claim_from_alphalend<T>(
    pool: &mut StreamPool<T>,
    protocol: &mut LendingProtocol,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    market_id: u64,
    max_amount: u64,
    ctx: &mut TxContext,
) {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);
    let cash = stream_pool::balance_value(pool);
    if (cash < claimable) {
        let shortfall = claimable - cash;
        let draw = if (shortfall < max_amount) { shortfall } else { max_amount };
        if (draw > 0) {
            pool_withdraw_alphalend<T>(
                pool, protocol, config, clock, registry, market_id, draw, ctx,
            );
        };
    };
}

// Org voluntarily unwinds `amount` of the pool's AlphaLend position back to idle
// cash. Enables rebalancing (unwind here, then pool_invest_<other> in the same PTB)
// and manual idle-cash top-ups. Org-gated — distinct from the package-internal
// `pool_withdraw_alphalend` used during claims, which runs on behalf of the employee.
public fun org_withdraw_alphalend<T>(
    pool: &mut StreamPool<T>,
    protocol: &mut LendingProtocol,
    config: &ProtocolConfig,
    clock: &Clock,
    registry: &ProtocolRegistry,
    market_id: u64,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    pool_withdraw_alphalend<T>(
        pool, protocol, config, clock, registry, market_id, amount, ctx,
    );
}

// ---- Yield-fee math (pure, unit-testable) ----

// fee = floor((gross - principal) * fee_bps / 10_000), 0 if no yield.
public(package) fun compute_yield_fee(gross: u64, principal: u64, fee_bps: u64): u64 {
    let yield_earned = if (gross > principal) { gross - principal } else { 0 };
    oz_u64::mul_div(yield_earned, fee_bps, 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow)
}

#[test_only]
public fun protocol_name(): vector<u8> { PROTOCOL_NAME }

// Test-only mirrors of the entry-gate asserts (same order + error constants). They
// let us prove gating without a live AlphaLend LendingProtocol, which cannot be
// constructed in a unit test.
#[test_only]
public fun assert_approved_for_test(registry: &ProtocolRegistry) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
}

#[test_only]
public fun assert_org_for_test<T>(
    registry: &ProtocolRegistry,
    pool: &StreamPool<T>,
    ctx: &TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
}

#[test_only]
public fun assert_owner_for_test(
    registry: &ProtocolRegistry,
    vault: &EmployeeVault,
    ctx: &TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);
}
