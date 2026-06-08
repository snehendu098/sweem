module sweem_registry::registry;

use sui::vec_map::{Self, VecMap};
use sui::event;
use std::string::String;
use openzeppelin_access::access_control::{Self, AccessControl};

// OTW — struct name must match module name in SCREAMING_SNAKE_CASE
public struct REGISTRY has drop {}

// Role types — must live in same module as REGISTRY to avoid EForeignRole
public struct FeeManagerRole has drop {}
public struct ProtocolManagerRole has drop {}

#[error] const EProtocolAlreadyExists: vector<u8> = b"Protocol with this name already exists";
#[error] const EProtocolNotFound: vector<u8> = b"Protocol not found in registry";
#[error] const EInvalidYieldType: vector<u8> = b"Yield type must be 0 (L), 1 (Y), or 2 (S)";
#[error] const EDepositFeeTooHigh: vector<u8> = b"Deposit fee exceeds maximum of 5%";
#[error] const EOrgYieldFeeTooHigh: vector<u8> = b"Org yield fee exceeds maximum of 50%";
#[error] const EVaultYieldFeeTooHigh: vector<u8> = b"Vault yield fee exceeds maximum of 50%";

const MAX_DEPOSIT_FEE_BPS: u64 = 500;
const MAX_YIELD_FEE_BPS: u64 = 5000;

public struct ProtocolRegistry has key {
    id: UID,
    protocols: VecMap<String, ProtocolEntry>,
}

public struct ProtocolConfig has key {
    id: UID,
    deposit_fee_bps: u64,
    org_yield_fee_bps: u64,
    vault_yield_fee_bps: u64,
    treasury: address,
}

public struct ProtocolEntry has store {
    adapter_package: address,
    yield_type: u8,
    enabled: bool,
}

public struct ProtocolAdded has copy, drop { name: String, adapter_package: address, yield_type: u8 }
public struct ProtocolDisabled has copy, drop { name: String }
public struct ProtocolEnabled has copy, drop { name: String }
public struct FeesUpdated has copy, drop { deposit_fee_bps: u64, org_yield_fee_bps: u64, vault_yield_fee_bps: u64 }
public struct TreasuryUpdated has copy, drop { new_treasury: address }

fun init(otw: REGISTRY, ctx: &mut TxContext) {
    let mut ac = access_control::new(otw, 0, ctx);
    // Grant all operational roles to deployer so they can act immediately
    access_control::grant_role<REGISTRY, FeeManagerRole>(&mut ac, ctx.sender(), ctx);
    access_control::grant_role<REGISTRY, ProtocolManagerRole>(&mut ac, ctx.sender(), ctx);
    transfer::public_share_object(ac);
    transfer::share_object(ProtocolRegistry {
        id: object::new(ctx),
        protocols: vec_map::empty(),
    });
    transfer::share_object(ProtocolConfig {
        id: object::new(ctx),
        deposit_fee_bps: 0,
        org_yield_fee_bps: 0,
        vault_yield_fee_bps: 0,
        treasury: ctx.sender(),
    });
}

public fun add_protocol(
    registry: &mut ProtocolRegistry,
    ac: &AccessControl<REGISTRY>,
    name: String,
    adapter_package: address,
    yield_type: u8,
    ctx: &TxContext,
) {
    access_control::assert_has_role<REGISTRY, ProtocolManagerRole>(ac, ctx.sender());
    assert!(!vec_map::contains(&registry.protocols, &name), EProtocolAlreadyExists);
    assert!(yield_type <= 2, EInvalidYieldType);
    vec_map::insert(&mut registry.protocols, name, ProtocolEntry { adapter_package, yield_type, enabled: true });
    event::emit(ProtocolAdded { name, adapter_package, yield_type });
}

public fun disable_protocol(
    registry: &mut ProtocolRegistry,
    ac: &AccessControl<REGISTRY>,
    name: String,
    ctx: &TxContext,
) {
    access_control::assert_has_role<REGISTRY, ProtocolManagerRole>(ac, ctx.sender());
    assert!(vec_map::contains(&registry.protocols, &name), EProtocolNotFound);
    vec_map::get_mut(&mut registry.protocols, &name).enabled = false;
    event::emit(ProtocolDisabled { name });
}

public fun enable_protocol(
    registry: &mut ProtocolRegistry,
    ac: &AccessControl<REGISTRY>,
    name: String,
    ctx: &TxContext,
) {
    access_control::assert_has_role<REGISTRY, ProtocolManagerRole>(ac, ctx.sender());
    assert!(vec_map::contains(&registry.protocols, &name), EProtocolNotFound);
    vec_map::get_mut(&mut registry.protocols, &name).enabled = true;
    event::emit(ProtocolEnabled { name });
}

public fun set_fees(
    config: &mut ProtocolConfig,
    ac: &AccessControl<REGISTRY>,
    deposit_fee_bps: u64,
    org_yield_fee_bps: u64,
    vault_yield_fee_bps: u64,
    ctx: &TxContext,
) {
    access_control::assert_has_role<REGISTRY, FeeManagerRole>(ac, ctx.sender());
    assert!(deposit_fee_bps <= MAX_DEPOSIT_FEE_BPS, EDepositFeeTooHigh);
    assert!(org_yield_fee_bps <= MAX_YIELD_FEE_BPS, EOrgYieldFeeTooHigh);
    assert!(vault_yield_fee_bps <= MAX_YIELD_FEE_BPS, EVaultYieldFeeTooHigh);
    config.deposit_fee_bps = deposit_fee_bps;
    config.org_yield_fee_bps = org_yield_fee_bps;
    config.vault_yield_fee_bps = vault_yield_fee_bps;
    event::emit(FeesUpdated { deposit_fee_bps, org_yield_fee_bps, vault_yield_fee_bps });
}

public fun set_treasury(
    config: &mut ProtocolConfig,
    ac: &AccessControl<REGISTRY>,
    treasury: address,
    ctx: &TxContext,
) {
    access_control::assert_has_role<REGISTRY, FeeManagerRole>(ac, ctx.sender());
    config.treasury = treasury;
    event::emit(TreasuryUpdated { new_treasury: treasury });
}

public fun is_approved(registry: &ProtocolRegistry, name: &String): bool {
    vec_map::contains(&registry.protocols, name)
        && vec_map::get(&registry.protocols, name).enabled
}

public fun protocols_by_type(registry: &ProtocolRegistry, yield_type: u8): vector<String> {
    let keys = vec_map::keys(&registry.protocols);
    let mut result = vector[];
    keys.do_ref!(|name| {
        let entry = vec_map::get(&registry.protocols, name);
        if (entry.enabled && entry.yield_type == yield_type) {
            result.push_back(*name);
        }
    });
    result
}

public fun deposit_fee_bps(config: &ProtocolConfig): u64 { config.deposit_fee_bps }
public fun org_yield_fee_bps(config: &ProtocolConfig): u64 { config.org_yield_fee_bps }
public fun vault_yield_fee_bps(config: &ProtocolConfig): u64 { config.vault_yield_fee_bps }
public fun treasury(config: &ProtocolConfig): address { config.treasury }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(REGISTRY {}, ctx); }

#[test_only]
public fun create_test_config(ctx: &mut TxContext): ProtocolConfig {
    ProtocolConfig {
        id: object::new(ctx),
        deposit_fee_bps: 0,
        org_yield_fee_bps: 0,
        vault_yield_fee_bps: 0,
        treasury: ctx.sender(),
    }
}
