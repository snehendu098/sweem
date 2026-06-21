/// AlphaFi stSUI liquid-staking yield adapter for Sweem (yield_type S = 2).
///
/// VAULT-ONLY by design. Org/pool payroll funds must NEVER enter an LST: only the
/// two employee-vault functions `vault_invest_stsui` / `vault_withdraw_stsui` exist
/// here. The deliberate ABSENCE of `pool_invest_*`, `pool_withdraw_*`,
/// `cover_claim_from_*`, and `org_withdraw_*` is the structural enforcement that
/// keeps org payroll money in L (lending) / Y (yield-stablecoin) strategies only.
///
/// Underlying T = SUI (`0x2::sui::SUI`); the staked receipt is `Coin<STSUI>`.
/// invest  = stake SUI -> stSUI via AlphaFi `liquid_staking::mint<STSUI>`.
/// withdraw = unstake stSUI -> SUI via AlphaFi `liquid_staking::redeem<STSUI>`
/// (instant, no unbonding). AlphaFi charges its own mint/redeem fees internally.
///
/// Yield model: stSUI is a share token whose SUI redemption value grows as staking
/// rewards accrue (share-price growth). We record the SUI principal at invest time
/// (`deposited_value`) and treat `gross_sui_out - deposited_value` (if positive) as
/// realized yield on withdraw; Sweem's `vault_yield_fee_bps` cut goes to treasury.
module sweem_adapters_stsui::stsui;

use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::coin::{Self, Coin};
use sui::event;

use sui::sui::SUI;
use sui_system::sui_system::SuiSystemState;
use liquid_staking::liquid_staking::{mint, redeem, LiquidStakingInfo};
use stsui::stsui::STSUI;

use sweem_core::employee_vault::{
    Self as employee_vault, EmployeeVault,
    borrow_bucket_mut, vault_uid_mut, bucket_uid_mut,
    split_bucket_for_invest, merge_bucket_from_yield,
};
use sweem_registry::registry::{
    ProtocolRegistry, ProtocolConfig,
    is_approved, vault_yield_fee_bps, treasury,
};
use openzeppelin_math::u64 as oz_u64;
use openzeppelin_math::rounding;
use std::string::String;

const PROTOCOL_NAME: vector<u8> = b"stsui";

#[error] const ENotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EProtocolNotApproved: vector<u8> = b"stSUI not approved in registry";
#[error] const ENoVaultPosition: vector<u8> = b"No stSUI position on this vault bucket";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in yield calculation";

// Coin<STSUI> is key+store -> stored via dof.
// StsuiPosition is store-only -> stored via df.
public struct StsuiVaultLstKey() has copy, drop, store;
public struct StsuiVaultPositionKey() has copy, drop, store;

public struct StsuiPosition has store {
    // SUI principal staked into stSUI (sum of `amount`s passed to invest).
    deposited_value: u64,
}

public struct StsuiInvested has copy, drop { object_id: ID, amount: u64 }
public struct StsuiReturned has copy, drop { object_id: ID, gross: u64, yield_fee: u64, net: u64 }

// Employee stakes `amount` of SUI from their vault bucket into AlphaFi stSUI.
// Bucket coin type is fixed to SUI — LSTs are SUI-native. The minted stSUI coin is
// stored (joined) under a DOF on the bucket; the SUI principal is accumulated in a DF.
public fun vault_invest_stsui(
    vault: &mut EmployeeVault,
    token_name: String,
    lst_info: &mut LiquidStakingInfo<STSUI>,
    system_state: &mut SuiSystemState,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<SUI>(vault, token_name);

    let sui_coin = coin::from_balance(split_bucket_for_invest(bucket, amount), ctx);
    // AlphaFi mint takes no Clock; it refreshes internally against the system state.
    let stsui_coin: Coin<STSUI> = mint<STSUI>(lst_info, system_state, sui_coin, ctx);

    let buid = bucket_uid_mut(bucket, registry);
    if (dof::exists(buid, StsuiVaultLstKey())) {
        let existing: &mut Coin<STSUI> = dof::borrow_mut(buid, StsuiVaultLstKey());
        existing.join(stsui_coin);
    } else {
        dof::add(buid, StsuiVaultLstKey(), stsui_coin);
    };

    if (df::exists(buid, StsuiVaultPositionKey())) {
        let pos: &mut StsuiPosition = df::borrow_mut(buid, StsuiVaultPositionKey());
        pos.deposited_value = pos.deposited_value + amount;
    } else {
        df::add(buid, StsuiVaultPositionKey(), StsuiPosition { deposited_value: amount });
    };

    event::emit(StsuiInvested { object_id: vault_id, amount });
}

// Employee redeems their FULL stSUI position back into their vault bucket as SUI.
// Full-position exit mirrors `vault_withdraw_scallop` (no partial amount). Yield =
// gross_sui_out - deposited_value (0 if not positive); the vault yield fee is split
// off to treasury, the remainder merged back into the bucket.
public fun vault_withdraw_stsui(
    vault: &mut EmployeeVault,
    token_name: String,
    lst_info: &mut LiquidStakingInfo<STSUI>,
    system_state: &mut SuiSystemState,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    ctx: &mut TxContext,
) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);

    let vault_id = vault_uid_mut(vault, ctx).to_inner();
    let bucket = borrow_bucket_mut<SUI>(vault, token_name);
    assert!(dof::exists(bucket_uid_mut(bucket, registry), StsuiVaultLstKey()), ENoVaultPosition);

    let stsui_coin: Coin<STSUI> = dof::remove(bucket_uid_mut(bucket, registry), StsuiVaultLstKey());

    let deposited_value = df::borrow<StsuiVaultPositionKey, StsuiPosition>(
        bucket_uid_mut(bucket, registry), StsuiVaultPositionKey(),
    ).deposited_value;

    // redeem param order is (self, lst, system_state, ctx).
    let gross_coin: Coin<SUI> = redeem<STSUI>(lst_info, stsui_coin, system_state, ctx);
    let gross = gross_coin.value();

    let fee = compute_yield_fee(gross, deposited_value, vault_yield_fee_bps(config));

    let mut gross_coin = gross_coin;
    if (fee > 0) {
        transfer::public_transfer(gross_coin.split(fee, ctx), treasury(config));
    };
    merge_bucket_from_yield(bucket, gross_coin.into_balance());

    let StsuiPosition { deposited_value: _ } = df::remove(
        bucket_uid_mut(bucket, registry), StsuiVaultPositionKey()
    );

    event::emit(StsuiReturned { object_id: vault_id, gross, yield_fee: fee, net: gross - fee });
}

// Pure yield-fee math, factored out so it can be unit-tested without a live
// AlphaFi pool. fee = floor((gross - principal) * fee_bps / 10_000), 0 if no yield.
public(package) fun compute_yield_fee(gross: u64, principal: u64, fee_bps: u64): u64 {
    let yield_earned = if (gross > principal) { gross - principal } else { 0 };
    oz_u64::mul_div(yield_earned, fee_bps, 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow)
}

#[test_only]
public fun protocol_name(): vector<u8> { PROTOCOL_NAME }

// Test-only mirrors of the two entry-gate asserts (same order, same error
// constants). They let us prove the gating without a live AlphaFi pool /
// SuiSystemState, which cannot be constructed in a unit test.
#[test_only]
public fun assert_approved_for_test(registry: &ProtocolRegistry) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
}

#[test_only]
public fun assert_owner_for_test(
    registry: &ProtocolRegistry,
    vault: &EmployeeVault,
    ctx: &TxContext,
) {
    // Mirror entry order: approval first, then owner.
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    assert!(employee_vault::owner(vault) == ctx.sender(), ENotOwner);
}
