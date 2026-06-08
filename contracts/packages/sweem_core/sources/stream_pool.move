module sweem_core::stream_pool;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::table::{Self, Table};
use sui::event;
use sweem_registry::registry::{ProtocolConfig, deposit_fee_bps, treasury};
use openzeppelin_math::u64 as oz_u64;
use openzeppelin_math::u128 as oz_u128;
use openzeppelin_math::rounding;
use std::string::String;

#[error] const ENotOrg: vector<u8> = b"Caller is not the organization";
#[error] const EStreamNotFound: vector<u8> = b"No stream found for this employee";
#[error] const EStreamAlreadyStopped: vector<u8> = b"Stream is already stopped";
#[error] const EStreamNotPaused: vector<u8> = b"Stream is not paused";
#[error] const EStreamNotActive: vector<u8> = b"Stream is not active (paused or stopped)";
#[error] const EInsufficientBalance: vector<u8> = b"Pool balance insufficient - call claim_with_liquidity instead";
#[error] const EZeroClaimable: vector<u8> = b"Nothing to claim yet";
#[error] const EEmployeeArrayMismatch: vector<u8> = b"employees, rate_amounts and rate_periods_ms must have equal length";
#[error] const EBelowMinClaimAmount: vector<u8> = b"Claim is below minimum (10% of weekly income at current rate)";
#[error] const EArithmeticOverflow: vector<u8> = b"Arithmetic overflow in stream calculation";
#[error] const EInvalidRatePeriod: vector<u8> = b"rate_period_ms must be greater than zero";

const WEEK_MS: u64 = 604_800_000;
const MIN_CLAIM_DENOM: u64 = 10;
const PAUSER_ROLE: u8 = 0x01;
const U64_MAX: u128 = 18_446_744_073_709_551_615;

public struct StreamPool<phantom T> has key {
    id: UID,
    org: address,
    total_deposited: u64,
    total_claimed: u64,
    balance: Balance<T>,
    streams: Table<address, Stream>,
    delegated_roles: Table<address, u8>,
}

public struct Stream has store {
    employee: address,
    rate_amount: u128,
    rate_period_ms: u64,
    pending_balance: u64,
    started_at: u64,
    claimed_at: u64,
    total_paused_ms: u64,
    paused_at: Option<u64>,
    stopped_at: Option<u64>,
}

public struct PoolFunded<phantom T> has copy, drop { pool_id: ID, org: address, gross: u64, fee: u64, net: u64, timestamp: u64 }
public struct StreamCreated<phantom T> has copy, drop { pool_id: ID, employee: address, rate_amount: u128, rate_period_ms: u64, started_at: u64 }
public struct PoolToppedUp<phantom T> has copy, drop { pool_id: ID, org: address, gross: u64, fee: u64, net: u64 }
public struct FundsClaimed<phantom T> has copy, drop { pool_id: ID, employee: address, amount: u64, timestamp: u64 }
public struct StreamPaused<phantom T> has copy, drop { pool_id: ID, employee: address, paused_at: u64 }
public struct StreamResumed<phantom T> has copy, drop { pool_id: ID, employee: address, resumed_at: u64 }
public struct StreamStopped<phantom T> has copy, drop { pool_id: ID, employee: address, stopped_at: u64 }
public struct PoolRoleGranted has copy, drop { pool_id: ID, account: address, role: u8 }
public struct PoolRoleRevoked has copy, drop { pool_id: ID, account: address, role: u8 }

public fun create_pool<T>(ctx: &mut TxContext): StreamPool<T> {
    StreamPool {
        id: object::new(ctx),
        org: ctx.sender(),
        total_deposited: 0,
        total_claimed: 0,
        balance: balance::zero(),
        streams: table::new(ctx),
        delegated_roles: table::new(ctx),
    }
}

entry fun create_and_share<T>(ctx: &mut TxContext) {
    transfer::share_object(create_pool<T>(ctx));
}

// Returns true if account is the org or holds the given role bit.
public fun has_pool_role<T>(pool: &StreamPool<T>, account: address, role: u8): bool {
    account == pool.org || (
        table::contains(&pool.delegated_roles, account) &&
        (*table::borrow(&pool.delegated_roles, account) & role != 0)
    )
}

public fun grant_pool_role<T>(pool: &mut StreamPool<T>, account: address, role: u8, ctx: &TxContext) {
    assert!(ctx.sender() == pool.org, ENotOrg);
    if (table::contains(&pool.delegated_roles, account)) {
        let bits = table::borrow_mut(&mut pool.delegated_roles, account);
        *bits = *bits | role;
    } else {
        table::add(&mut pool.delegated_roles, account, role);
    };
    event::emit(PoolRoleGranted { pool_id: pool.id.to_inner(), account, role });
}

public fun revoke_pool_role<T>(pool: &mut StreamPool<T>, account: address, role: u8, ctx: &TxContext) {
    assert!(ctx.sender() == pool.org, ENotOrg);
    if (table::contains(&pool.delegated_roles, account)) {
        let bits = table::borrow_mut(&mut pool.delegated_roles, account);
        *bits = *bits & (role ^ 0xFF);
    };
    event::emit(PoolRoleRevoked { pool_id: pool.id.to_inner(), account, role });
}

public fun pauser_role(): u8 { PAUSER_ROLE }

public fun deposit<T>(
    pool: &mut StreamPool<T>,
    config: &ProtocolConfig,
    payment: Coin<T>,
    employees: vector<address>,
    rate_amounts: vector<u128>,
    rate_periods_ms: vector<u64>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(employees.length() == rate_amounts.length() && employees.length() == rate_periods_ms.length(), EEmployeeArrayMismatch);

    let gross = payment.value();
    let fee_bps = deposit_fee_bps(config);
    let fee = oz_u64::mul_div(gross, fee_bps, 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);
    let net = gross - fee;

    let mut payment = payment;
    if (fee > 0) {
        transfer::public_transfer(payment.split(fee, ctx), treasury(config));
    };
    pool.balance.join(payment.into_balance());
    pool.total_deposited = pool.total_deposited + net;

    let now = clock.timestamp_ms();
    let pool_id = pool.id.to_inner();

    employees.length().do!(|i| {
        let employee = employees[i];
        let rate_amount = rate_amounts[i];
        let rate_period_ms = rate_periods_ms[i];
        assert!(rate_period_ms > 0, EInvalidRatePeriod);
        if (table::contains(&pool.streams, employee)) {
            let stream = table::borrow_mut(&mut pool.streams, employee);
            // Crystallize earnings at the old rate before updating — prevents the org from
            // retroactively manipulating an employee's accrued-but-unclaimed pay.
            let crystal_end = if (option::is_some(&stream.paused_at)) {
                *option::borrow(&stream.paused_at)
            } else if (option::is_some(&stream.stopped_at)) {
                *option::borrow(&stream.stopped_at)
            } else {
                now
            };
            let elapsed = crystal_end - stream.claimed_at - stream.total_paused_ms;
            let earned_u128 = oz_u128::mul_div(
                elapsed as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down()
            ).destroy_or!(abort EArithmeticOverflow);
            assert!(earned_u128 <= U64_MAX, EArithmeticOverflow);
            let earned = earned_u128 as u64;
            let new_pending = (stream.pending_balance as u128) + (earned as u128);
            assert!(new_pending <= U64_MAX, EArithmeticOverflow);
            stream.pending_balance = new_pending as u64;
            stream.claimed_at = crystal_end;
            stream.total_paused_ms = 0;
            stream.rate_amount = rate_amount;
            stream.rate_period_ms = rate_period_ms;
        } else {
            table::add(&mut pool.streams, employee, Stream {
                employee,
                rate_amount,
                rate_period_ms,
                pending_balance: 0,
                started_at: now,
                claimed_at: now,
                total_paused_ms: 0,
                paused_at: option::none(),
                stopped_at: option::none(),
            });
            event::emit(StreamCreated<T> { pool_id, employee, rate_amount, rate_period_ms, started_at: now });
        }
    });

    event::emit(PoolFunded<T> { pool_id, org: ctx.sender(), gross, fee, net, timestamp: now });
}

public fun topup<T>(
    pool: &mut StreamPool<T>,
    config: &ProtocolConfig,
    payment: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == pool.org, ENotOrg);

    let gross = payment.value();
    let fee_bps = deposit_fee_bps(config);
    let fee = oz_u64::mul_div(gross, fee_bps, 10_000, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);
    let net = gross - fee;

    let mut payment = payment;
    if (fee > 0) {
        transfer::public_transfer(payment.split(fee, ctx), treasury(config));
    };
    pool.balance.join(payment.into_balance());
    pool.total_deposited = pool.total_deposited + net;

    event::emit(PoolToppedUp<T> { pool_id: pool.id.to_inner(), org: ctx.sender(), gross, fee, net });
}

public fun claim<T>(pool: &mut StreamPool<T>, clock: &Clock, ctx: &mut TxContext): Coin<T> {
    assert!(table::contains(&pool.streams, ctx.sender()), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, ctx.sender());

    let effective_end = if (option::is_some(&stream.paused_at)) {
        *option::borrow(&stream.paused_at)
    } else if (option::is_some(&stream.stopped_at)) {
        *option::borrow(&stream.stopped_at)
    } else {
        clock.timestamp_ms()
    };

    let elapsed = effective_end - stream.claimed_at - stream.total_paused_ms;
    let new_earned_u128 = oz_u128::mul_div(elapsed as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down())
        .destroy_or!(abort EArithmeticOverflow);
    assert!(new_earned_u128 <= U64_MAX, EArithmeticOverflow);
    let new_earned = new_earned_u128 as u64;
    let total_u128 = (stream.pending_balance as u128) + (new_earned as u128);
    assert!(total_u128 <= U64_MAX, EArithmeticOverflow);
    let claimable = total_u128 as u64;
    assert!(claimable > 0, EZeroClaimable);

    let min_claim = (oz_u128::mul_div(WEEK_MS as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down())
        .destroy_or!(abort EArithmeticOverflow) as u64) / MIN_CLAIM_DENOM;
    // Bypass min_claim when crystallized earnings exist — a rate change shouldn't lock up earned pay.
    assert!(claimable >= min_claim || stream.pending_balance > 0, EBelowMinClaimAmount);
    assert!(pool.balance.value() >= claimable, EInsufficientBalance);

    pool.total_claimed = pool.total_claimed + claimable;
    stream.claimed_at = effective_end;
    stream.total_paused_ms = 0;
    stream.pending_balance = 0;

    let now = clock.timestamp_ms();
    let pool_id = pool.id.to_inner();
    let employee = ctx.sender();
    event::emit(FundsClaimed<T> { pool_id, employee, amount: claimable, timestamp: now });

    coin::from_balance(pool.balance.split(claimable), ctx)
}

entry fun claim_and_keep<T>(pool: &mut StreamPool<T>, clock: &Clock, ctx: &mut TxContext) {
    let coin = claim(pool, clock, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

public fun pause_stream<T>(
    pool: &mut StreamPool<T>,
    employee: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(has_pool_role(pool, ctx.sender(), PAUSER_ROLE), ENotOrg);
    assert!(table::contains(&pool.streams, employee), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, employee);
    assert!(option::is_none(&stream.paused_at) && option::is_none(&stream.stopped_at), EStreamNotActive);
    let now = clock.timestamp_ms();
    stream.paused_at = option::some(now);
    event::emit(StreamPaused<T> { pool_id: pool.id.to_inner(), employee, paused_at: now });
}

public fun resume_stream<T>(
    pool: &mut StreamPool<T>,
    employee: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(has_pool_role(pool, ctx.sender(), PAUSER_ROLE), ENotOrg);
    assert!(table::contains(&pool.streams, employee), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, employee);
    assert!(option::is_some(&stream.paused_at), EStreamNotPaused);
    let paused_since = *option::borrow(&stream.paused_at);
    stream.total_paused_ms = stream.total_paused_ms + clock.timestamp_ms() - paused_since;
    stream.paused_at = option::none();
    let now = clock.timestamp_ms();
    event::emit(StreamResumed<T> { pool_id: pool.id.to_inner(), employee, resumed_at: now });
}

public fun stop_stream<T>(
    pool: &mut StreamPool<T>,
    employee: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(table::contains(&pool.streams, employee), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, employee);
    assert!(option::is_none(&stream.stopped_at), EStreamAlreadyStopped);
    if (option::is_some(&stream.paused_at)) {
        stream.stopped_at = stream.paused_at;
        stream.paused_at = option::none();
    } else {
        stream.stopped_at = option::some(clock.timestamp_ms());
    };
    let stopped_at = *option::borrow(&stream.stopped_at);
    event::emit(StreamStopped<T> { pool_id: pool.id.to_inner(), employee, stopped_at });
}

public fun claimable_amount<T>(pool: &StreamPool<T>, employee: address, clock: &Clock): u64 {
    if (!table::contains(&pool.streams, employee)) return 0;
    let stream = table::borrow(&pool.streams, employee);
    let effective_end = if (option::is_some(&stream.paused_at)) {
        *option::borrow(&stream.paused_at)
    } else if (option::is_some(&stream.stopped_at)) {
        *option::borrow(&stream.stopped_at)
    } else {
        clock.timestamp_ms()
    };
    let elapsed = effective_end - stream.claimed_at - stream.total_paused_ms;
    let v = oz_u128::mul_div(elapsed as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down())
        .destroy_or!(return stream.pending_balance);
    let total = (stream.pending_balance as u128) + v;
    if (total > U64_MAX) return 0;
    total as u64
}

public fun org<T>(pool: &StreamPool<T>): address { pool.org }
public fun total_deposited<T>(pool: &StreamPool<T>): u64 { pool.total_deposited }
public fun total_claimed<T>(pool: &StreamPool<T>): u64 { pool.total_claimed }
public fun balance_value<T>(pool: &StreamPool<T>): u64 { pool.balance.value() }
public fun has_stream<T>(pool: &StreamPool<T>, employee: address): bool { table::contains(&pool.streams, employee) }

public fun borrow_uid<T>(pool: &StreamPool<T>): &UID { &pool.id }
public fun borrow_uid_mut<T>(pool: &mut StreamPool<T>): &mut UID { &mut pool.id }

#[test_only]
public fun create_pool_for_testing<T>(ctx: &mut TxContext): StreamPool<T> { create_pool(ctx) }
