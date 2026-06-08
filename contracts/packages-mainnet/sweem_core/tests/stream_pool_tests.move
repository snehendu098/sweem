module sweem_core::stream_pool_tests;

use sui::test_scenario::{Self, return_shared};
use sui::clock;
use sui::coin;
use std::unit_test::{assert_eq, destroy};
use sweem_core::stream_pool::{Self, StreamPool};
use openzeppelin_access::access_control::AccessControl;
use sweem_registry::registry::{Self, REGISTRY, ProtocolConfig};

public struct USDC has drop {}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fun create_pool_sets_org() {
    let ctx = &mut tx_context::dummy();
    let pool = stream_pool::create_pool<USDC>(4, ctx);
    // dummy() sender is @0x0
    assert_eq!(stream_pool::org(&pool), @0x0);
    destroy(pool);
}

#[test]
fun deposit_creates_stream_and_credits_balance() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(10_000_000_000, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(
        &mut pool, &config, payment,
        vector[employee], vector[100_000_000u128], vector[2_592_000_000u64],
        &clock, scenario.ctx(),
    );
    assert_eq!(stream_pool::total_deposited(&pool), 10_000_000_000);
    assert_eq!(stream_pool::balance_value(&pool), 10_000_000_000);
    assert!(stream_pool::has_stream(&pool, employee));
    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun deposit_deducts_fee() {
    let admin = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut config = scenario.take_shared<ProtocolConfig>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::set_fees(&mut config, &ac, 100, 0, 0, scenario.ctx()); // 1% deposit fee
    return_shared(ac);

    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(100_000_000, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(
        &mut pool, &config, payment,
        vector[employee], vector[100_000_000u128], vector[2_592_000_000u64],
        &clock, scenario.ctx(),
    );
    // 1% fee → net = 99_000_000
    assert_eq!(stream_pool::balance_value(&pool), 99_000_000);
    clock::destroy_for_testing(clock);
    destroy(pool);
    return_shared(config);
    scenario.end();
}

#[test]
fun topup_extends_balance() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    let p1 = coin::mint_for_testing<USDC>(100_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, p1, vector[employee], vector[100_000_000u128], vector[2_592_000_000u64], &clock, scenario.ctx());
    let p2 = coin::mint_for_testing<USDC>(50_000_000, scenario.ctx());
    stream_pool::topup(&mut pool, &config, p2, scenario.ctx());

    assert_eq!(stream_pool::balance_value(&pool), 150_000_000);
    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun employee_can_claim_after_accrual() {
    let org = @0xA;
    let employee = @0xB;
    // slice_per_ms = 1, advance 1 week = 604_800_000 ms
    // claimable  = 604_800_000 * 1 = 604_800_000
    // min_claim  = 1 * 604_800_000 / 10 = 60_480_000
    // pool needs >= 604_800_000 balance
    let slice: u128 = 1;
    let advance_ms: u64 = 604_800_000;
    let expected_claim: u64 = ((advance_ms as u128) * slice) as u64;

    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());

    let payment = coin::mint_for_testing<USDC>(3_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[slice], vector[1u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, advance_ms);

    scenario.next_tx(employee);
    let coin_out = stream_pool::claim(&mut pool, &clock, scenario.ctx());
    assert_eq!(coin_out.value(), expected_claim);

    clock::destroy_for_testing(clock);
    destroy(coin_out);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test, expected_failure(abort_code = stream_pool::EBelowMinClaimAmount, location = stream_pool)]
fun claim_below_min_aborts() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(1_000_000_000_000, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    // slice = 1, min_claim = 60_480_000; advance only 60_000_000 ms (< 1 week)
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[1u128], vector[1u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 60_000_000);
    scenario.next_tx(employee);
    destroy(stream_pool::claim(&mut pool, &clock, scenario.ctx()));
    abort 0
}

#[test, expected_failure(abort_code = stream_pool::EZeroClaimable, location = stream_pool)]
fun claim_zero_aborts() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(3_000_000_000, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    // No clock advance → claimed_at == effective_end → claimable = 0
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[1u128], vector[1u64], &clock, scenario.ctx());
    scenario.next_tx(employee);
    destroy(stream_pool::claim(&mut pool, &clock, scenario.ctx()));
    abort 0
}

#[test, expected_failure(abort_code = stream_pool::EStreamNotFound, location = stream_pool)]
fun claim_fails_without_stream() {
    let org = @0xA;
    let unknown = @0xC;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    scenario.next_tx(unknown);
    destroy(stream_pool::claim(&mut pool, &clock, scenario.ctx()));
    destroy(config);
    abort 0
}

#[test]
fun pause_stream_stops_accrual() {
    let org = @0xA;
    let employee = @0xB;
    let slice: u128 = 1;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(3_000_000_000, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[slice], vector[1u64], &clock, scenario.ctx());

    clock::increment_for_testing(&mut clock, 100);
    stream_pool::pause_stream(&mut pool, employee, &clock, scenario.ctx());
    let claimable_at_pause = stream_pool::claimable_amount(&pool, employee, &clock);

    // advance another 100ms while paused — claimable must not change
    clock::increment_for_testing(&mut clock, 100);
    let claimable_later = stream_pool::claimable_amount(&pool, employee, &clock);
    assert_eq!(claimable_at_pause, claimable_later);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun resume_stream_resumes_accrual() {
    let org = @0xA;
    let employee = @0xB;
    let slice: u128 = 1;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(3_000_000_000, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[slice], vector[1u64], &clock, scenario.ctx());

    // earn 200ms, pause, wait 300ms (paused), resume, earn 400ms
    clock::increment_for_testing(&mut clock, 200);
    stream_pool::pause_stream(&mut pool, employee, &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 300);
    stream_pool::resume_stream(&mut pool, employee, &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 400);

    // claimable = (200 + 400) * slice = 600
    assert_eq!(stream_pool::claimable_amount(&pool, employee, &clock), (600u128 * slice) as u64);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun stop_stream_finalizes() {
    let org = @0xA;
    let employee = @0xB;
    let slice: u128 = 1;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(3_000_000_000, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[slice], vector[1u64], &clock, scenario.ctx());

    clock::increment_for_testing(&mut clock, 500);
    stream_pool::stop_stream(&mut pool, employee, &clock, scenario.ctx());
    let claimable_at_stop = stream_pool::claimable_amount(&pool, employee, &clock);
    assert_eq!(claimable_at_stop, (500u128 * slice) as u64);

    // further time should not increase claimable
    clock::increment_for_testing(&mut clock, 1000);
    assert_eq!(stream_pool::claimable_amount(&pool, employee, &clock), claimable_at_stop);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test, expected_failure(abort_code = stream_pool::ENotOrg, location = stream_pool)]
fun non_org_cannot_deposit() {
    let org = @0xA;
    let intruder = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    scenario.next_tx(intruder);
    let payment = coin::mint_for_testing<USDC>(1_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[@0xC], vector[100u128], vector[1u64], &clock, scenario.ctx());
    abort 0
}

#[test, expected_failure(abort_code = stream_pool::ENotOrg, location = stream_pool)]
fun non_org_cannot_pause() {
    let org = @0xA;
    let employee = @0xB;
    let intruder = @0xC;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(1_000_000_000, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[100_000_000u128], vector[2_592_000_000u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 100);
    scenario.next_tx(intruder);
    stream_pool::pause_stream(&mut pool, employee, &clock, scenario.ctx());
    abort 0
}

#[test]
fun claimable_amount_returns_zero_for_unknown() {
    let org = @0xA;
    let unknown = @0xFF;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    assert_eq!(stream_pool::claimable_amount(&pool, unknown, &clock), 0);
    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

// ── Multi-asset precision tests ────────────────────────────────────────────────

#[test]
fun usdc_100_per_month_earns_correct_after_10_days() {
    // 100 USDC/month, 6 decimals
    // rate_amount = 100_000_000 (100 * 10^6)
    // rate_period_ms = 2_592_000_000 (30 days)
    // after 10 days (864_000_000 ms): expected = 864_000_000 * 100_000_000 / 2_592_000_000 = 33_333_333
    let org = @0xA;
    let employee = @0xB;
    let rate_amount: u128 = 100_000_000;
    let rate_period_ms: u64 = 2_592_000_000;
    let advance_ms: u64 = 864_000_000; // 10 days

    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(1_000_000_000, scenario.ctx());

    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[rate_amount], vector[rate_period_ms], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, advance_ms);

    let claimable = stream_pool::claimable_amount(&pool, employee, &clock);
    // 864_000_000 * 100_000_000 / 2_592_000_000 = 33_333_333
    assert_eq!(claimable, 33_333_333);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun sui_100_per_month_earns_correct_after_10_days() {
    // 100 SUI/month, 9 decimals
    // rate_amount = 100_000_000_000 (100 * 10^9)
    // rate_period_ms = 2_592_000_000
    // after 10 days: 864_000_000 * 100_000_000_000 / 2_592_000_000 = 33_333_333_333
    let org = @0xA;
    let employee = @0xB;
    let rate_amount: u128 = 100_000_000_000;
    let rate_period_ms: u64 = 2_592_000_000;
    let advance_ms: u64 = 864_000_000;

    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    // fund with enough for one month
    let payment = coin::mint_for_testing<USDC>(100_000_000_000, scenario.ctx());

    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[rate_amount], vector[rate_period_ms], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, advance_ms);

    let claimable = stream_pool::claimable_amount(&pool, employee, &clock);
    assert_eq!(claimable, 33_333_333_333);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test, expected_failure(abort_code = stream_pool::EInvalidRatePeriod, location = stream_pool)]
fun deposit_with_zero_rate_period_aborts() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(1_000_000, scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[100u128], vector[0u64], &clock, scenario.ctx());
    abort 0
}

#[test]
fun rate_change_crystallizes_old_earnings() {
    // Org changes rate from 100 USDC/month → 50 USDC/month after 10 days.
    // Employee must still be able to claim the 33_333_333 earned at the old rate.
    let org = @0xA;
    let employee = @0xB;
    let rate_period_ms: u64 = 2_592_000_000;

    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());

    let payment1 = coin::mint_for_testing<USDC>(2_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment1, vector[employee], vector[100_000_000u128], vector[rate_period_ms], &clock, scenario.ctx());

    // Advance 10 days → 864_000_000 * 100_000_000 / 2_592_000_000 = 33_333_333 earned
    clock::increment_for_testing(&mut clock, 864_000_000);

    // Org re-deposits with lower rate
    let payment2 = coin::mint_for_testing<USDC>(2_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment2, vector[employee], vector[50_000_000u128], vector[rate_period_ms], &clock, scenario.ctx());

    // Crystallized earnings are immediately claimable
    assert_eq!(stream_pool::claimable_amount(&pool, employee, &clock), 33_333_333);

    // Advance another 10 days at new rate → 864_000_000 * 50_000_000 / 2_592_000_000 = 16_666_666
    clock::increment_for_testing(&mut clock, 864_000_000);
    assert_eq!(stream_pool::claimable_amount(&pool, employee, &clock), 49_999_999);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}

#[test]
fun precision_loss_avoided_for_small_usdc_rate() {
    // Demonstrates the fix: 100 USDC/month previously gave slice_per_ms = 0
    // With rate_amount + rate_period_ms, claimable after 1 day is non-zero
    // 1 day = 86_400_000 ms
    // expected = 86_400_000 * 100_000_000 / 2_592_000_000 = 3_333_333
    let org = @0xA;
    let employee = @0xB;
    let rate_amount: u128 = 100_000_000;
    let rate_period_ms: u64 = 2_592_000_000;

    let mut scenario = test_scenario::begin(org);
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(4, scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());
    let payment = coin::mint_for_testing<USDC>(1_000_000_000, scenario.ctx());

    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[rate_amount], vector[rate_period_ms], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 86_400_000); // 1 day

    let claimable = stream_pool::claimable_amount(&pool, employee, &clock);
    assert!(claimable > 0); // would be 0 with old slice_per_ms approach
    assert_eq!(claimable, 3_333_333);

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(config);
    scenario.end();
}
