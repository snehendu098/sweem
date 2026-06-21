#[test_only]
module sweem_adapters::usdy_tests;

use sui::test_scenario as ts;
use sui::clock;
use sui::coin;
use std::string;
use std::unit_test::destroy;

use sweem_core::stream_pool::{Self, StreamPool};
use sweem_core::employee_vault;
use sweem_registry::registry::{Self, ProtocolRegistry, ProtocolConfig};
use sweem_adapters::usdy::{
    Self,
    assert_approved_for_test, assert_pool_org_for_test, assert_vault_owner_for_test,
    pool_invest_extract_unchecked, pool_invest_deposit_unchecked,
    pool_withdraw_extract_unchecked, pool_withdraw_deposit_unchecked,
    pool_position_y_value,
    compute_yield_fee, pro_rate_principal,
};

const ORG: address = @0xA;
const EMP: address = @0xB;
const STRANGER: address = @0xC;

// Base payroll token (T) and the yield coin (Y, stands in for USDY).
public struct USDC has drop {}
public struct USDY has drop {}

// Fund a pool with `amount` of USDC, no streams (committed = 0 -> no coverage floor).
fun fund_pool(sc: &mut ts::Scenario, pool: &mut StreamPool<USDC>, cfg: &ProtocolConfig, amount: u64) {
    let clk = clock::create_for_testing(ts::ctx(sc));
    let pay = coin::mint_for_testing<USDC>(amount, ts::ctx(sc));
    stream_pool::deposit(pool, cfg, pay, vector[], vector[], vector[], &clk, ts::ctx(sc));
    clock::destroy_for_testing(clk);
}

// ── pure math: compute_yield_fee (the realized-USDY-yield fee) ───────────────────────

#[test]
fun fee_zero_when_no_yield() {
    assert!(compute_yield_fee(1_000, 1_000, 1_000) == 0, 0);
    assert!(compute_yield_fee(950, 1_000, 1_000) == 0, 1); // swap-back returned less than principal
}

#[test]
fun fee_basic_and_rounding() {
    assert!(compute_yield_fee(1_100, 1_000, 1_000) == 10, 0); // 10% of 100 yield
    assert!(compute_yield_fee(1_100, 1_000, 500) == 5, 1);    // 5% of 100
    assert!(compute_yield_fee(1_100, 1_000, 0) == 0, 2);      // 0 bps
    assert!(compute_yield_fee(1_100, 1_000, 333) == 3, 3);    // 100*333/10000 = 3.33 -> 3
    // large values, no overflow
    assert!(compute_yield_fee(1_200_000_000, 1_000_000_000, 1_000) == 20_000_000, 4);
}

// ── pure math: pro_rate_principal (partial-unwind principal slice) ───────────────────

#[test]
fun pro_rate_full_returns_all_principal() {
    assert!(pro_rate_principal(1_000, 500, 500, true) == 1_000, 0);
}

#[test]
fun pro_rate_partial_rounds_up() {
    assert!(pro_rate_principal(1_000, 50, 100, false) == 500, 0);   // exact half
    assert!(pro_rate_principal(1_000, 1, 3, false) == 334, 1);      // 333.33 -> round up 334
    assert!(pro_rate_principal(1_000, 999, 1_000, false) == 999, 2);
}

// ── approval gate: empty registry -> EProtocolNotApproved ────────────────────────────

#[test]
#[expected_failure(abort_code = usdy::EProtocolNotApproved)]
fun aborts_when_not_approved() {
    let mut sc = ts::begin(ORG);
    registry::init_for_testing(ts::ctx(&mut sc)); // shares an EMPTY registry
    ts::next_tx(&mut sc, ORG);
    let reg = ts::take_shared<ProtocolRegistry>(&sc);

    assert_approved_for_test(&reg); // usdy not added -> abort

    ts::return_shared(reg);
    ts::end(sc);
}

// ── org gate: non-org caller -> ENotOrg ──────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = usdy::ENotOrg)]
fun pool_org_gate_rejects_stranger() {
    let mut sc = ts::begin(ORG);
    let pool = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));

    ts::next_tx(&mut sc, STRANGER);
    assert_pool_org_for_test(&pool, ts::ctx(&mut sc)); // STRANGER != org -> abort

    destroy(pool);
    ts::end(sc);
}

#[test]
fun pool_org_gate_accepts_org() {
    let mut sc = ts::begin(ORG);
    let pool = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    assert_pool_org_for_test(&pool, ts::ctx(&mut sc)); // ORG == org -> ok
    destroy(pool);
    ts::end(sc);
}

// ── owner gate (vault): non-owner -> ENotOwner ───────────────────────────────────────

#[test]
#[expected_failure(abort_code = usdy::ENotOwner)]
fun vault_owner_gate_rejects_stranger() {
    let mut sc = ts::begin(EMP);
    let vault = employee_vault::create_vault(ts::ctx(&mut sc)); // EMP owns

    ts::next_tx(&mut sc, STRANGER);
    assert_vault_owner_for_test(&vault, ts::ctx(&mut sc)); // STRANGER != owner -> abort

    destroy(vault);
    ts::end(sc);
}

// ── receipt mismatch: invest receipt deposited into a DIFFERENT pool aborts ──────────

#[test]
#[expected_failure(abort_code = usdy::EReceiptMismatch)]
fun invest_receipt_wrong_pool_aborts() {
    let mut sc = ts::begin(ORG);
    let cfg = registry::create_test_config(ts::ctx(&mut sc));
    let mut pool_a = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    let mut pool_b = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    fund_pool(&mut sc, &mut pool_a, &cfg, 1_000);

    let (base, receipt) = pool_invest_extract_unchecked<USDC>(&mut pool_a, 500, ts::ctx(&mut sc));
    let usdy = coin::mint_for_testing<USDY>(500, ts::ctx(&mut sc)); // UI "swap" stand-in
    destroy(base);

    // pool-A receipt deposited into pool B -> EReceiptMismatch (cannot under-deposit / cross-pair).
    pool_invest_deposit_unchecked<USDC, USDY>(&mut pool_b, usdy, receipt, ts::ctx(&mut sc));

    destroy(pool_a); destroy(pool_b); destroy(cfg);
    ts::end(sc);
}

// ── receipt mismatch on the withdraw direction (wrong pool) ──────────────────────────

#[test]
#[expected_failure(abort_code = usdy::EReceiptMismatch)]
fun withdraw_receipt_wrong_pool_aborts() {
    let mut sc = ts::begin(ORG);
    let cfg = registry::create_test_config(ts::ctx(&mut sc));
    let reg = make_registry(&mut sc);
    let mut pool_a = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    let mut pool_b = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    fund_pool(&mut sc, &mut pool_a, &cfg, 1_000);

    // Build a USDY position on pool A.
    let (base, inv_r) = pool_invest_extract_unchecked<USDC>(&mut pool_a, 500, ts::ctx(&mut sc));
    destroy(base);
    let usdy = coin::mint_for_testing<USDY>(500, ts::ctx(&mut sc));
    pool_invest_deposit_unchecked<USDC, USDY>(&mut pool_a, usdy, inv_r, ts::ctx(&mut sc));

    // Extract a withdraw receipt from A, deposit recovered T into B -> abort.
    let (y_out, wd_r) = pool_withdraw_extract_unchecked<USDC, USDY>(&mut pool_a, 500, ts::ctx(&mut sc));
    destroy(y_out);
    let recovered = coin::mint_for_testing<USDC>(500, ts::ctx(&mut sc));
    pool_withdraw_deposit_unchecked<USDC>(&mut pool_b, &cfg, &reg, recovered, wd_r, ts::ctx(&mut sc));

    destroy(pool_a); destroy(pool_b); destroy(cfg);
    ts::return_shared(reg);
    ts::end(sc);
}

// ── full pool round-trip (zero fee) proving the realized yield merges back into idle ─

#[test]
fun pool_full_round_trip_yield_merges_back() {
    let mut sc = ts::begin(ORG);
    let cfg = registry::create_test_config(ts::ctx(&mut sc)); // zero fees
    let reg = make_registry(&mut sc);
    let mut pool = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    fund_pool(&mut sc, &mut pool, &cfg, 10_000);

    // 1) extract 1_000 USDC.
    let (base, inv_r) = pool_invest_extract_unchecked<USDC>(&mut pool, 1_000, ts::ctx(&mut sc));
    assert!(base.value() == 1_000, 0);
    assert!(stream_pool::balance_value(&pool) == 9_000, 1);
    destroy(base);

    // 2) UI swaps 1_000 USDC -> 1_000 USDY; deposit as position.
    let usdy = coin::mint_for_testing<USDY>(1_000, ts::ctx(&mut sc));
    pool_invest_deposit_unchecked<USDC, USDY>(&mut pool, usdy, inv_r, ts::ctx(&mut sc));
    assert!(pool_position_y_value<USDC, USDY>(&pool) == 1_000, 2);

    // 3) withdraw full USDY position.
    let (y_out, wd_r) = pool_withdraw_extract_unchecked<USDC, USDY>(&mut pool, 1_000, ts::ctx(&mut sc));
    assert!(y_out.value() == 1_000, 3);
    assert!(pool_position_y_value<USDC, USDY>(&pool) == 0, 4); // fully unwound
    destroy(y_out);

    // 4) UI swaps 1_000 USDY -> 1_200 USDC (accrued). Zero fee -> all 1_200 merges.
    let recovered = coin::mint_for_testing<USDC>(1_200, ts::ctx(&mut sc));
    pool_withdraw_deposit_unchecked<USDC>(&mut pool, &cfg, &reg, recovered, wd_r, ts::ctx(&mut sc));
    assert!(stream_pool::balance_value(&pool) == 10_200, 5); // 9_000 + 1_200

    destroy(pool); destroy(cfg);
    ts::return_shared(reg);
    ts::end(sc);
}

// ── partial pool withdraw pro-rates principal + leaves the remainder invested ────────

#[test]
fun pool_partial_withdraw_keeps_remainder() {
    let mut sc = ts::begin(ORG);
    let cfg = registry::create_test_config(ts::ctx(&mut sc));
    let reg = make_registry(&mut sc);
    let mut pool = stream_pool::create_pool_for_testing<USDC>(ts::ctx(&mut sc));
    fund_pool(&mut sc, &mut pool, &cfg, 10_000);

    let (base, inv_r) = pool_invest_extract_unchecked<USDC>(&mut pool, 1_000, ts::ctx(&mut sc));
    destroy(base);
    let usdy = coin::mint_for_testing<USDY>(1_000, ts::ctx(&mut sc));
    pool_invest_deposit_unchecked<USDC, USDY>(&mut pool, usdy, inv_r, ts::ctx(&mut sc));

    // withdraw half (500 of 1_000) -> 500 USDY out, 500 remains custodied.
    let (y_out, wd_r) = pool_withdraw_extract_unchecked<USDC, USDY>(&mut pool, 500, ts::ctx(&mut sc));
    assert!(y_out.value() == 500, 0);
    assert!(pool_position_y_value<USDC, USDY>(&pool) == 500, 1); // remainder still invested
    destroy(y_out);
    let recovered = coin::mint_for_testing<USDC>(560, ts::ctx(&mut sc));
    pool_withdraw_deposit_unchecked<USDC>(&mut pool, &cfg, &reg, recovered, wd_r, ts::ctx(&mut sc));
    assert!(stream_pool::balance_value(&pool) == 9_560, 2); // 9_000 + 560 (zero fee)

    // drain the remaining 500 -> position intact, succeeds.
    let (y_rest, wd_r2) = pool_withdraw_extract_unchecked<USDC, USDY>(&mut pool, 500, ts::ctx(&mut sc));
    assert!(y_rest.value() == 500, 3);
    destroy(y_rest);
    let rec2 = coin::mint_for_testing<USDC>(500, ts::ctx(&mut sc));
    pool_withdraw_deposit_unchecked<USDC>(&mut pool, &cfg, &reg, rec2, wd_r2, ts::ctx(&mut sc));
    assert!(stream_pool::balance_value(&pool) == 10_060, 4); // 9_560 + 500

    destroy(pool); destroy(cfg);
    ts::return_shared(reg);
    ts::end(sc);
}

// ── helper: a shared ProtocolRegistry (empty is fine — the _unchecked plumbing only
// reads the registry-gated UID accessor, not approval). ──────────────────────────────
fun make_registry(sc: &mut ts::Scenario): ProtocolRegistry {
    registry::init_for_testing(ts::ctx(sc));
    let sender = ts::sender(sc);
    ts::next_tx(sc, sender);
    ts::take_shared<ProtocolRegistry>(sc)
}
