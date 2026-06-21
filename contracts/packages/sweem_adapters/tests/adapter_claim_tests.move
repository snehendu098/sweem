#[test_only]
module sweem_adapters::adapter_claim_tests;

use sui::test_scenario;
use sui::clock;
use sui::coin;
use std::string;
use std::unit_test::destroy;
use sweem_core::stream_pool;
use sweem_registry::registry;
use sweem_adapters::navi;
use sweem_adapters::scallop;
use sweem_adapters::suilend;

public struct USDC has drop {}

fun approved_registry(ctx: &mut TxContext): registry::ProtocolRegistry {
    registry::create_test_registry_with(
        vector[string::utf8(b"navi"), string::utf8(b"scallop"), string::utf8(b"suilend")],
        ctx,
    )
}

fun registry_without_suilend(ctx: &mut TxContext): registry::ProtocolRegistry {
    registry::create_test_registry_with(
        vector[string::utf8(b"navi"), string::utf8(b"scallop")],
        ctx,
    )
}

// ── cover_claim no-op safety ────────────────────────────────────────────────

// Org sender, no stream for sender → claimable == 0 → cover is a no-op, no abort.
#[test]
fun cover_claim_navi_noop_when_no_claim() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    // org has no stream → claimable 0 → cash(0) < claimable(0) is false → no-op
    navi::cover_claim_from_navi<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun cover_claim_scallop_noop_when_no_claim() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    scallop::cover_claim_from_scallop<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

// Non-employee address with no stream → claimable 0 → no-op (no abort).
#[test]
fun cover_claim_navi_noop_for_non_employee() {
    let org = @0xA;
    let stranger = @0xDEAD;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    scenario.next_tx(stranger);
    navi::cover_claim_from_navi<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun cover_claim_scallop_noop_for_non_employee() {
    let org = @0xA;
    let stranger = @0xDEAD;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    scenario.next_tx(stranger);
    scallop::cover_claim_from_scallop<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

// cover_claim when claim is fully covered by pool cash → cash >= claimable → no draw.
#[test]
fun cover_claim_navi_noop_when_covered() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());

    // Fund well above what accrues; slice 1/ms, advance 1 week.
    let payment = coin::mint_for_testing<USDC>(10_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[1u128], vector[1u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 604_800_000);

    // employee claimable = 604_800_000, pool cash = 10_000_000_000 > claimable → covered → no-op
    scenario.next_tx(employee);
    navi::cover_claim_from_navi<USDC>(&mut pool, &reg, &config, &clock, 1_000_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun cover_claim_scallop_noop_when_covered() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());

    let payment = coin::mint_for_testing<USDC>(10_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[1u128], vector[1u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 604_800_000);

    scenario.next_tx(employee);
    scallop::cover_claim_from_scallop<USDC>(&mut pool, &reg, &config, &clock, 1_000_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

// ── org_withdraw happy path (org sender, approved protocol) ──────────────────

#[test]
fun org_withdraw_navi_happy_path() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    // org == sender, protocol approved → succeeds (stub emits event only)
    navi::org_withdraw_navi<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());

    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun org_withdraw_scallop_happy_path() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    scallop::org_withdraw_scallop<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());

    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

// ── org_withdraw authorization (non-org aborts, code 1) ──────────────────────

#[test, expected_failure(abort_code = 1, location = sweem_adapters::navi)]
fun org_withdraw_navi_non_org_aborts() {
    let org = @0xA;
    let intruder = @0xC;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    scenario.next_tx(intruder);
    navi::org_withdraw_navi<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());
    abort 0
}

#[test, expected_failure(abort_code = 1, location = sweem_adapters::scallop)]
fun org_withdraw_scallop_non_org_aborts() {
    let org = @0xA;
    let intruder = @0xC;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    scenario.next_tx(intruder);
    scallop::org_withdraw_scallop<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());
    abort 0
}

// ── suilend mirrors (same gating/auth contract as navi/scallop) ──────────────

#[test]
fun cover_claim_suilend_noop_when_no_claim() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    suilend::cover_claim_from_suilend<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun cover_claim_suilend_noop_for_non_employee() {
    let org = @0xA;
    let stranger = @0xDEAD;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let clock = clock::create_for_testing(scenario.ctx());

    scenario.next_tx(stranger);
    suilend::cover_claim_from_suilend<USDC>(&mut pool, &reg, &config, &clock, 1_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun cover_claim_suilend_noop_when_covered() {
    let org = @0xA;
    let employee = @0xB;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());
    let mut clock = clock::create_for_testing(scenario.ctx());

    let payment = coin::mint_for_testing<USDC>(10_000_000_000, scenario.ctx());
    stream_pool::deposit(&mut pool, &config, payment, vector[employee], vector[1u128], vector[1u64], &clock, scenario.ctx());
    clock::increment_for_testing(&mut clock, 604_800_000);

    scenario.next_tx(employee);
    suilend::cover_claim_from_suilend<USDC>(&mut pool, &reg, &config, &clock, 1_000_000_000, scenario.ctx());

    clock::destroy_for_testing(clock);
    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test]
fun org_withdraw_suilend_happy_path() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    suilend::org_withdraw_suilend<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());

    destroy(pool);
    destroy(reg);
    destroy(config);
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = sweem_adapters::suilend)]
fun org_withdraw_suilend_non_org_aborts() {
    let org = @0xA;
    let intruder = @0xC;
    let mut scenario = test_scenario::begin(org);
    let reg = approved_registry(scenario.ctx());
    let config = registry::create_test_config(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    scenario.next_tx(intruder);
    suilend::org_withdraw_suilend<USDC>(&mut pool, &reg, &config, 500, scenario.ctx());
    abort 0
}

// Org sender but suilend NOT approved in registry → pool_invest aborts (code 0).
#[test, expected_failure(abort_code = 0, location = sweem_adapters::suilend)]
fun pool_invest_suilend_unapproved_aborts() {
    let org = @0xA;
    let mut scenario = test_scenario::begin(org);
    let reg = registry_without_suilend(scenario.ctx());
    let mut pool = stream_pool::create_pool<USDC>(scenario.ctx());

    suilend::pool_invest_suilend<USDC>(&mut pool, &reg, 500, scenario.ctx());
    abort 0
}
