module sweem_registry::registry_tests;

use sui::test_scenario::{Self, return_shared};
use openzeppelin_access::access_control::AccessControl;
use sweem_registry::registry::{Self, REGISTRY, ProtocolRegistry, ProtocolConfig};
use std::string;
use std::unit_test::assert_eq;

#[test]
fun init_creates_objects() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    let registry = scenario.take_shared<ProtocolRegistry>();
    let config = scenario.take_shared<ProtocolConfig>();
    return_shared(ac);
    return_shared(registry);
    return_shared(config);
    scenario.end();
}

#[test]
fun add_and_approve_protocol() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut reg = scenario.take_shared<ProtocolRegistry>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    let config = scenario.take_shared<ProtocolConfig>();
    registry::add_protocol(&mut reg, &ac, string::utf8(b"navi"), @0x1, 0, scenario.ctx());
    assert_eq!(registry::is_approved(&reg, &string::utf8(b"navi")), true);
    return_shared(ac);
    return_shared(reg);
    return_shared(config);
    scenario.end();
}

#[test]
fun disable_removes_approval() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut reg = scenario.take_shared<ProtocolRegistry>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    let config = scenario.take_shared<ProtocolConfig>();
    registry::add_protocol(&mut reg, &ac, string::utf8(b"navi"), @0x1, 0, scenario.ctx());
    registry::disable_protocol(&mut reg, &ac, string::utf8(b"navi"), scenario.ctx());
    assert_eq!(registry::is_approved(&reg, &string::utf8(b"navi")), false);
    return_shared(ac);
    return_shared(reg);
    return_shared(config);
    scenario.end();
}

#[test]
fun enable_restores_approval() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut reg = scenario.take_shared<ProtocolRegistry>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    let config = scenario.take_shared<ProtocolConfig>();
    registry::add_protocol(&mut reg, &ac, string::utf8(b"navi"), @0x1, 0, scenario.ctx());
    registry::disable_protocol(&mut reg, &ac, string::utf8(b"navi"), scenario.ctx());
    registry::enable_protocol(&mut reg, &ac, string::utf8(b"navi"), scenario.ctx());
    assert_eq!(registry::is_approved(&reg, &string::utf8(b"navi")), true);
    return_shared(ac);
    return_shared(reg);
    return_shared(config);
    scenario.end();
}

#[test, expected_failure(abort_code = registry::EProtocolAlreadyExists, location = registry)]
fun duplicate_protocol_aborts() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut reg = scenario.take_shared<ProtocolRegistry>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::add_protocol(&mut reg, &ac, string::utf8(b"navi"), @0x1, 0, scenario.ctx());
    registry::add_protocol(&mut reg, &ac, string::utf8(b"navi"), @0x2, 0, scenario.ctx());
    abort 0
}

#[test, expected_failure(abort_code = registry::EInvalidYieldType, location = registry)]
fun invalid_yield_type_aborts() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut reg = scenario.take_shared<ProtocolRegistry>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::add_protocol(&mut reg, &ac, string::utf8(b"bad"), @0x1, 3, scenario.ctx());
    abort 0
}

#[test]
fun set_fees_updates_config() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut config = scenario.take_shared<ProtocolConfig>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::set_fees(&mut config, &ac, 25, 1000, 1000, scenario.ctx());
    assert_eq!(registry::deposit_fee_bps(&config), 25);
    return_shared(ac);
    return_shared(config);
    scenario.end();
}

#[test, expected_failure(abort_code = registry::EDepositFeeTooHigh, location = registry)]
fun deposit_fee_too_high_aborts() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut config = scenario.take_shared<ProtocolConfig>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::set_fees(&mut config, &ac, 600, 0, 0, scenario.ctx());
    abort 0
}

#[test]
fun set_treasury_updates() {
    let admin = @0xA;
    let mut scenario = test_scenario::begin(admin);
    registry::init_for_testing(scenario.ctx());
    scenario.next_tx(admin);
    let mut config = scenario.take_shared<ProtocolConfig>();
    let ac = scenario.take_shared<AccessControl<REGISTRY>>();
    registry::set_treasury(&mut config, &ac, @0xBEEF, scenario.ctx());
    assert_eq!(registry::treasury(&config), @0xBEEF);
    return_shared(ac);
    return_shared(config);
    scenario.end();
}
