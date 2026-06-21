#[test_only]
module sweem_adapters_alphalend::alphalend_tests;

use sui::test_scenario as ts;
use std::string;
use std::unit_test::destroy;

use sweem_adapters_alphalend::alphalend::{
    Self as alphalend_adapter,
    compute_yield_fee,
};
use sweem_core::employee_vault;
use sweem_registry::registry::{Self, ProtocolRegistry, REGISTRY};
use openzeppelin_access::access_control::AccessControl;

const OWNER: address = @0xA11CE;
const STRANGER: address = @0xB0B;

// ---- compute_yield_fee math (pure) ----

#[test]
fun fee_zero_when_no_yield() {
    // gross == principal -> no yield -> no fee
    assert!(compute_yield_fee(1_000, 1_000, 1_000) == 0, 0);
    // gross < principal -> no yield -> no fee
    assert!(compute_yield_fee(950, 1_000, 1_000) == 0, 1);
}

#[test]
fun fee_basic_yield() {
    // gross 1_100, principal 1_000 -> yield 100; 1000 bps (10%) -> fee 10
    assert!(compute_yield_fee(1_100, 1_000, 1_000) == 10, 0);
    // 500 bps (5%) of 100 yield -> 5
    assert!(compute_yield_fee(1_100, 1_000, 500) == 5, 1);
    // zero fee bps -> 0 regardless of yield
    assert!(compute_yield_fee(2_000, 1_000, 0) == 0, 2);
}

#[test]
fun fee_rounds_down() {
    // yield 100, 333 bps -> 100 * 333 / 10000 = 3.33 -> floor 3
    assert!(compute_yield_fee(1_100, 1_000, 333) == 3, 0);
}

#[test]
fun fee_large_values_no_overflow() {
    // 10_000 USDC yield (1e10, 6dp) at 1000 bps -> 1e9
    assert!(compute_yield_fee(110_000_000_000, 100_000_000_000, 1_000) == 1_000_000_000, 0);
}

// ---- registry approval gate ----

// Registry exists but `alphalend` is NOT added -> is_approved false -> abort.
// Mirrors the FIRST assert of every entry fn, which fires before any live
// AlphaLend object is touched.
#[test]
#[expected_failure(abort_code = alphalend_adapter::EProtocolNotApproved)]
fun aborts_when_not_approved() {
    let mut sc = ts::begin(OWNER);
    registry::init_for_testing(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, OWNER);

    let registry = ts::take_shared<ProtocolRegistry>(&sc);
    alphalend_adapter::assert_approved_for_test(&registry);

    ts::return_shared(registry);
    ts::end(sc);
}

// ---- owner-only gate (vault path) ----

// Approved protocol, but caller != vault owner -> abort on the owner check
// (the SECOND assert, after approval passes).
#[test]
#[expected_failure(abort_code = alphalend_adapter::ENotOwner)]
fun aborts_when_not_owner() {
    let mut sc = ts::begin(OWNER);
    registry::init_for_testing(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, OWNER);

    // Approve `alphalend` (yield_type 0 = L) so the approval gate passes.
    let mut registry = ts::take_shared<ProtocolRegistry>(&sc);
    let ac = ts::take_shared<AccessControl<REGISTRY>>(&sc);
    registry::add_protocol(
        &mut registry, &ac, string::utf8(b"alphalend"), @0x1, 0, ts::ctx(&mut sc),
    );

    // OWNER owns this vault.
    let vault = employee_vault::create_vault(ts::ctx(&mut sc));

    // STRANGER acts on OWNER's vault -> owner assert aborts.
    ts::next_tx(&mut sc, STRANGER);
    alphalend_adapter::assert_owner_for_test(&registry, &vault, ts::ctx(&mut sc));

    destroy(vault);
    ts::return_shared(ac);
    ts::return_shared(registry);
    ts::end(sc);
}

// ---- org-only gate (pool path) ----

// Approved protocol, but caller != pool org -> abort on the org check. Exercises
// the pool-side gate that distinguishes this full adapter from the vault-only
// stSUI adapter.
#[test]
#[expected_failure(abort_code = alphalend_adapter::ENotOrg)]
fun aborts_when_not_org() {
    let mut sc = ts::begin(OWNER);
    registry::init_for_testing(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, OWNER);

    let mut registry = ts::take_shared<ProtocolRegistry>(&sc);
    let ac = ts::take_shared<AccessControl<REGISTRY>>(&sc);
    registry::add_protocol(
        &mut registry, &ac, string::utf8(b"alphalend"), @0x1, 0, ts::ctx(&mut sc),
    );

    // OWNER is the pool org.
    let pool = sweem_core::stream_pool::create_pool_for_testing<sui::sui::SUI>(ts::ctx(&mut sc));

    // STRANGER acts on OWNER's pool -> org assert aborts.
    ts::next_tx(&mut sc, STRANGER);
    alphalend_adapter::assert_org_for_test(&registry, &pool, ts::ctx(&mut sc));

    destroy(pool);
    ts::return_shared(ac);
    ts::return_shared(registry);
    ts::end(sc);
}

// ---- protocol name sanity ----

#[test]
fun protocol_name_is_alphalend() {
    assert!(alphalend_adapter::protocol_name() == b"alphalend", 0);
}
