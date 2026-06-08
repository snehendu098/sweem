module sweem_core::employee_vault_tests;

use sui::test_scenario;
use sui::coin;
use std::unit_test::destroy;
use std::unit_test::assert_eq;
use std::string;
use sweem_core::employee_vault::{Self, EmployeeVault};

public struct USDC has drop {}

#[test]
fun create_vault_sets_owner() {
    let ctx = &mut tx_context::dummy();
    let vault = employee_vault::create_vault(ctx);
    assert_eq!(employee_vault::owner(&vault), @0x0);
    destroy(vault);
}

#[test]
fun init_bucket_creates_bucket() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    assert!(employee_vault::bucket_exists(&vault, string::utf8(b"USDC")));
    destroy(vault);
}

#[test]
fun deposit_increases_bucket_balance() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    let coin = coin::mint_for_testing<USDC>(1_000, ctx);
    employee_vault::deposit_to_bucket(&mut vault, string::utf8(b"USDC"), coin, ctx);
    assert_eq!(employee_vault::bucket_balance<USDC>(&vault, string::utf8(b"USDC")), 1_000);
    destroy(vault);
}

#[test]
fun withdraw_decreases_balance() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    let coin = coin::mint_for_testing<USDC>(1_000, ctx);
    employee_vault::deposit_to_bucket(&mut vault, string::utf8(b"USDC"), coin, ctx);
    let withdrawn = employee_vault::withdraw_from_bucket<USDC>(&mut vault, string::utf8(b"USDC"), 500, ctx);
    assert_eq!(employee_vault::bucket_balance<USDC>(&vault, string::utf8(b"USDC")), 500);
    destroy(withdrawn);
    destroy(vault);
}

#[test, expected_failure(abort_code = employee_vault::EBucketAlreadyExists, location = employee_vault)]
fun duplicate_bucket_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    abort 0
}

#[test, expected_failure(abort_code = employee_vault::EBucketNotFound, location = employee_vault)]
fun deposit_without_bucket_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    let coin = coin::mint_for_testing<USDC>(100, ctx);
    employee_vault::deposit_to_bucket(&mut vault, string::utf8(b"USDC"), coin, ctx);
    abort 0
}

#[test, expected_failure(abort_code = employee_vault::EInsufficientBucketBal, location = employee_vault)]
fun overdraw_bucket_aborts() {
    let ctx = &mut tx_context::dummy();
    let mut vault = employee_vault::create_vault(ctx);
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), ctx);
    let coin = coin::mint_for_testing<USDC>(100, ctx);
    employee_vault::deposit_to_bucket(&mut vault, string::utf8(b"USDC"), coin, ctx);
    let withdrawn = employee_vault::withdraw_from_bucket<USDC>(&mut vault, string::utf8(b"USDC"), 200, ctx);
    destroy(withdrawn);
    abort 0
}

#[test, expected_failure(abort_code = employee_vault::EVaultNotOwner, location = employee_vault)]
fun non_owner_cannot_deposit() {
    let owner = @0xA;
    let intruder = @0xB;
    let mut scenario = test_scenario::begin(owner);
    let mut vault = employee_vault::create_vault(scenario.ctx());
    employee_vault::init_bucket<USDC>(&mut vault, string::utf8(b"USDC"), scenario.ctx());
    scenario.next_tx(intruder);
    let coin = coin::mint_for_testing<USDC>(100, scenario.ctx());
    employee_vault::deposit_to_bucket(&mut vault, string::utf8(b"USDC"), coin, scenario.ctx());
    destroy(vault);
    scenario.end();
}
