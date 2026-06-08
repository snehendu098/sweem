module sweem_core::employee_vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_object_field as dof;
use sui::event;
use std::string::String;

#[error] const EVaultNotOwner: vector<u8> = b"Caller is not the vault owner";
#[error] const EBucketNotFound: vector<u8> = b"No bucket for this token - call init_bucket first";
#[error] const EBucketAlreadyExists: vector<u8> = b"Bucket already exists for this token";
#[error] const EInsufficientBucketBal: vector<u8> = b"Insufficient balance in bucket";

public struct EmployeeVault has key {
    id: UID,
    owner: address,
}

public struct TokenBucket<phantom T> has key, store {
    id: UID,
    balance: Balance<T>,
}

public struct TokenKey(String) has copy, drop, store;

public struct VaultCreated has copy, drop { vault_id: ID, owner: address }
public struct BucketInitialized has copy, drop { vault_id: ID, token: String }
public struct BucketDeposited has copy, drop { vault_id: ID, token: String, amount: u64 }
public struct BucketWithdrawn has copy, drop { vault_id: ID, token: String, amount: u64 }

public fun create_vault(ctx: &mut TxContext): EmployeeVault {
    let vault = EmployeeVault { id: object::new(ctx), owner: ctx.sender() };
    event::emit(VaultCreated { vault_id: vault.id.to_inner(), owner: ctx.sender() });
    vault
}

entry fun create_and_keep(ctx: &mut TxContext) {
    let vault = create_vault(ctx);
    transfer::transfer(vault, ctx.sender());
}

public fun init_bucket<T>(vault: &mut EmployeeVault, token_name: String, ctx: &mut TxContext) {
    assert!(vault.owner == ctx.sender(), EVaultNotOwner);
    assert!(!dof::exists(&vault.id, TokenKey(token_name)), EBucketAlreadyExists);
    dof::add(
        &mut vault.id,
        TokenKey(token_name),
        TokenBucket<T> { id: object::new(ctx), balance: balance::zero() },
    );
    event::emit(BucketInitialized { vault_id: vault.id.to_inner(), token: token_name });
}

public fun deposit_to_bucket<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    coin: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(vault.owner == ctx.sender(), EVaultNotOwner);
    assert!(dof::exists(&vault.id, TokenKey(token_name)), EBucketNotFound);
    let amount = coin.value();
    let bucket: &mut TokenBucket<T> = dof::borrow_mut(&mut vault.id, TokenKey(token_name));
    bucket.balance.join(coin.into_balance());
    event::emit(BucketDeposited { vault_id: vault.id.to_inner(), token: token_name, amount });
}

public fun withdraw_from_bucket<T>(
    vault: &mut EmployeeVault,
    token_name: String,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(vault.owner == ctx.sender(), EVaultNotOwner);
    assert!(dof::exists(&vault.id, TokenKey(token_name)), EBucketNotFound);
    let bucket: &mut TokenBucket<T> = dof::borrow_mut(&mut vault.id, TokenKey(token_name));
    assert!(bucket.balance.value() >= amount, EInsufficientBucketBal);
    let coin = coin::from_balance(bucket.balance.split(amount), ctx);
    event::emit(BucketWithdrawn { vault_id: vault.id.to_inner(), token: token_name, amount });
    coin
}

public fun borrow_bucket_mut<T>(vault: &mut EmployeeVault, token_name: String): &mut TokenBucket<T> {
    assert!(dof::exists(&vault.id, TokenKey(token_name)), EBucketNotFound);
    dof::borrow_mut(&mut vault.id, TokenKey(token_name))
}

public fun owner(vault: &EmployeeVault): address { vault.owner }

public fun bucket_exists(vault: &EmployeeVault, token_name: String): bool {
    dof::exists(&vault.id, TokenKey(token_name))
}

public fun bucket_balance<T>(vault: &EmployeeVault, token_name: String): u64 {
    if (!dof::exists(&vault.id, TokenKey(token_name))) return 0;
    let bucket: &TokenBucket<T> = dof::borrow(&vault.id, TokenKey(token_name));
    bucket.balance.value()
}

public fun vault_uid(vault: &EmployeeVault): &UID { &vault.id }
public fun vault_uid_mut(vault: &mut EmployeeVault): &mut UID { &mut vault.id }

public fun bucket_uid_mut<T>(bucket: &mut TokenBucket<T>): &mut UID { &mut bucket.id }
