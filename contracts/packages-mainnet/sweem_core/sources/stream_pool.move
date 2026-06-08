module sweem_core::stream_pool;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::Clock;
use sui::table::{Self, Table};
use sui::event;
use sweem_registry::registry::{ProtocolConfig, ProtocolRegistry, deposit_fee_bps, treasury};
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
#[error] const EWrongVersion: vector<u8> = b"Pool version mismatch — upgrade the pool before use";
#[error] const EInsufficientCoverage: vector<u8> = b"Pool balance must cover the committed coverage weeks of total payroll";
#[error] const ENoWithdrawableBalance: vector<u8> = b"No excess balance to withdraw — pool must keep coverage weeks of committed payroll";
#[error] const EInvalidCoverageWeeks: vector<u8> = b"min_coverage_weeks must be at least 1";
#[error] const ENoPendingOrgTransfer: vector<u8> = b"No pending org transfer to accept or cancel";
#[error] const ENotPendingOrg: vector<u8> = b"Caller is not the pending org";

const WEEK_MS: u64 = 604_800_000;
const MIN_CLAIM_DENOM: u64 = 10;
const PAUSER_ROLE: u8 = 0x01;
const U64_MAX: u128 = 18_446_744_073_709_551_615;
const VERSION: u64 = 1;

public struct StreamPool<phantom T> has key {
    id: UID,
    version: u64,
    org: address,
    total_deposited: u64,
    total_claimed: u64,
    balance: Balance<T>,
    streams: Table<address, Stream>,
    delegated_roles: Table<address, u8>,
    total_weekly_committed: u128,  // sum of (rate_amount * WEEK_MS / rate_period_ms) across active streams
    min_coverage_weeks: u64,       // weeks of committed payroll the pool must keep as cash
    pending_org: Option<address>,  // set during two-step org transfer; cleared on accept or cancel
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
public struct OrgTransferProposed<phantom T> has copy, drop { pool_id: ID, current_org: address, proposed_to: address }
public struct OrgTransferCancelled<phantom T> has copy, drop { pool_id: ID, cancelled_by: address }
public struct OrgTransferred<phantom T> has copy, drop { pool_id: ID, old_org: address, new_org: address }
public struct ExcessWithdrawn<phantom T> has copy, drop { pool_id: ID, org: address, amount: u64 }

public fun create_pool<T>(min_coverage_weeks: u64, ctx: &mut TxContext): StreamPool<T> {
    assert!(min_coverage_weeks >= 1, EInvalidCoverageWeeks);
    StreamPool {
        id: object::new(ctx),
        version: VERSION,
        org: ctx.sender(),
        total_deposited: 0,
        total_claimed: 0,
        balance: balance::zero(),
        streams: table::new(ctx),
        delegated_roles: table::new(ctx),
        total_weekly_committed: 0,
        min_coverage_weeks,
        pending_org: option::none(),
    }
}

entry fun create_and_share<T>(min_coverage_weeks: u64, ctx: &mut TxContext) {
    transfer::share_object(create_pool<T>(min_coverage_weeks, ctx));
}

// Bumps the pool's version after a package upgrade so existing shared pools can
// be used with the new package. Org-gated; idempotent guard on current version.
entry fun migrate<T>(pool: &mut StreamPool<T>, ctx: &TxContext) {
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(pool.version < VERSION, EWrongVersion);
    pool.version = VERSION;
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
        event::emit(PoolRoleRevoked { pool_id: pool.id.to_inner(), account, role });
    };
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
    assert!(pool.version == VERSION, EWrongVersion);
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
            // A stopped stream already had its weekly rate removed from
            // total_weekly_committed by stop_stream; re-adding it here would
            // double-subtract on the next update and abort. Track this so we
            // only ADD the new weekly for a restarting stream.
            let was_stopped = option::is_some(&stream.stopped_at);
            // Crystallize earnings at the old rate before updating — prevents the org from
            // retroactively manipulating an employee's accrued-but-unclaimed pay.
            let crystal_end = if (option::is_some(&stream.paused_at)) {
                *option::borrow(&stream.paused_at)
            } else if (option::is_some(&stream.stopped_at)) {
                *option::borrow(&stream.stopped_at)
            } else {
                now
            };
            // Safe elapsed: never underflow if total_paused_ms exceeds the active span
            // (matches the guard used in `claim`).
            let active_span = crystal_end - stream.claimed_at;
            let elapsed = if (active_span > stream.total_paused_ms) { active_span - stream.total_paused_ms } else { 0 };
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
            // Restart a stopped stream from now so the new rate begins accruing;
            // otherwise stopped_at would freeze it and the new rate would never apply.
            stream.stopped_at = option::none();
            if (was_stopped) {
                stream.claimed_at = now;
                stream.started_at = now;
            };
            // Capture old rate before overwriting so we can adjust the committed total.
            let old_rate_amount = stream.rate_amount;
            let old_rate_period_ms = stream.rate_period_ms;
            stream.rate_amount = rate_amount;
            stream.rate_period_ms = rate_period_ms;
            // Adjust committed total. For a stopped stream the old weekly was already
            // removed in stop_stream, so only ADD the new weekly. For an active/paused
            // stream, remove the old contribution and add the new one.
            let new_weekly = oz_u128::mul_div(rate_amount, WEEK_MS as u128, rate_period_ms as u128, rounding::up())
                .destroy_or!(abort EArithmeticOverflow);
            if (was_stopped) {
                pool.total_weekly_committed = pool.total_weekly_committed + new_weekly;
            } else {
                let old_weekly = oz_u128::mul_div(old_rate_amount, WEEK_MS as u128, old_rate_period_ms as u128, rounding::up())
                    .destroy_or!(abort EArithmeticOverflow);
                pool.total_weekly_committed = pool.total_weekly_committed - old_weekly + new_weekly;
            };
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
            let weekly = oz_u128::mul_div(rate_amount, WEEK_MS as u128, rate_period_ms as u128, rounding::up())
                .destroy_or!(abort EArithmeticOverflow);
            pool.total_weekly_committed = pool.total_weekly_committed + weekly;
            event::emit(StreamCreated<T> { pool_id, employee, rate_amount, rate_period_ms, started_at: now });
        }
    });

    let min_required = pool.total_weekly_committed * (pool.min_coverage_weeks as u128);
    assert!(pool.balance.value() as u128 >= min_required, EInsufficientCoverage);

    event::emit(PoolFunded<T> { pool_id, org: ctx.sender(), gross, fee, net, timestamp: now });
}

public fun topup<T>(
    pool: &mut StreamPool<T>,
    config: &ProtocolConfig,
    payment: Coin<T>,
    ctx: &mut TxContext,
) {
    assert!(pool.version == VERSION, EWrongVersion);
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
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(table::contains(&pool.streams, ctx.sender()), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, ctx.sender());

    let effective_end = if (option::is_some(&stream.paused_at)) {
        *option::borrow(&stream.paused_at)
    } else if (option::is_some(&stream.stopped_at)) {
        *option::borrow(&stream.stopped_at)
    } else {
        clock.timestamp_ms()
    };

    let active_span = effective_end - stream.claimed_at;
    let elapsed = if (active_span > stream.total_paused_ms) { active_span - stream.total_paused_ms } else { 0 };
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
    assert!(pool.version == VERSION, EWrongVersion);
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
    assert!(pool.version == VERSION, EWrongVersion);
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
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(table::contains(&pool.streams, employee), EStreamNotFound);
    let stream = table::borrow_mut(&mut pool.streams, employee);
    assert!(option::is_none(&stream.stopped_at), EStreamAlreadyStopped);
    if (option::is_some(&stream.paused_at)) {
        // Stopped while paused: freeze at the pause point. effective_end becomes
        // paused_at, so active_span = paused_at - claimed_at. Cap total_paused_ms
        // to that span so prior pause/resume cycles can't push elapsed underflow.
        let paused_at_val = *option::borrow(&stream.paused_at);
        stream.stopped_at = option::some(paused_at_val);
        stream.paused_at = option::none();
        let active_span = paused_at_val - stream.claimed_at;
        if (stream.total_paused_ms > active_span) {
            stream.total_paused_ms = active_span;
        };
    } else {
        stream.stopped_at = option::some(clock.timestamp_ms());
    };
    let stopped_at = *option::borrow(&stream.stopped_at);
    let weekly = oz_u128::mul_div(stream.rate_amount, WEEK_MS as u128, stream.rate_period_ms as u128, rounding::up())
        .destroy_or!(abort EArithmeticOverflow);
    pool.total_weekly_committed = if (pool.total_weekly_committed >= weekly) {
        pool.total_weekly_committed - weekly
    } else { 0 };
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
    let active_span = effective_end - stream.claimed_at;
    let elapsed = if (active_span > stream.total_paused_ms) { active_span - stream.total_paused_ms } else { 0 };
    let v = oz_u128::mul_div(elapsed as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down())
        .destroy_or!(return stream.pending_balance);
    let total = (stream.pending_balance as u128) + v;
    if (total > U64_MAX) return 0;
    total as u64
}

public fun org<T>(pool: &StreamPool<T>): address { pool.org }
public fun pending_org<T>(pool: &StreamPool<T>): Option<address> { pool.pending_org }
public fun total_deposited<T>(pool: &StreamPool<T>): u64 { pool.total_deposited }
public fun total_claimed<T>(pool: &StreamPool<T>): u64 { pool.total_claimed }
public fun balance_value<T>(pool: &StreamPool<T>): u64 { pool.balance.value() }
public fun min_coverage_weeks<T>(pool: &StreamPool<T>): u64 { pool.min_coverage_weeks }
public fun has_stream<T>(pool: &StreamPool<T>, employee: address): bool { table::contains(&pool.streams, employee) }

public fun borrow_uid<T>(pool: &StreamPool<T>): &UID { &pool.id }

// Org-gated mutable UID — for invest/setup operations initiated by the org.
// Prevents arbitrary external packages from attaching junk dynamic fields to the
// shared pool object.
public fun borrow_uid_mut<T>(pool: &mut StreamPool<T>, ctx: &TxContext): &mut UID {
    assert!(ctx.sender() == pool.org, ENotOrg);
    &mut pool.id
}

// Registry-gated mutable UID — for yield withdraw/claim operations that are NOT
// org-initiated (called on behalf of employees during claim). Requiring a valid
// ProtocolRegistry proves the caller is operating within the official system;
// adapters additionally enforce `is_approved` at their own boundary.
public fun borrow_uid_mut_yield<T>(pool: &mut StreamPool<T>, _registry: &ProtocolRegistry): &mut UID {
    &mut pool.id
}

// Extract balance for yield investment — org-gated.
// Enforces coverage floor: the remaining cash after invest must still
// cover pool.min_coverage_weeks of committed payroll.
public fun split_balance_for_invest<T>(
    pool: &mut StreamPool<T>,
    amount: u64,
    ctx: &TxContext,
): Balance<T> {
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(pool.balance.value() >= amount, EInsufficientBalance);
    let min_required = pool.total_weekly_committed * (pool.min_coverage_weeks as u128);
    assert!((pool.balance.value() - amount) as u128 >= min_required, EInsufficientCoverage);
    pool.balance.split(amount)
}

// Return yield proceeds back into the pool
public fun merge_balance_from_yield<T>(pool: &mut StreamPool<T>, bal: Balance<T>) {
    pool.balance.join(bal);
}

// Org reclaims overfunded balance above the mandatory 4-week coverage buffer.
// Org-gated. Returns the excess as a Coin so a PTB can route it (e.g. into a
// vault or back to the org). Aborts if nothing is withdrawable.
public fun withdraw_excess<T>(pool: &mut StreamPool<T>, ctx: &mut TxContext): Coin<T> {
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(ctx.sender() == pool.org, ENotOrg);
    let min_required = pool.total_weekly_committed * (pool.min_coverage_weeks as u128);
    let bal = pool.balance.value() as u128;
    assert!(bal > min_required, ENoWithdrawableBalance);
    let withdrawable = (bal - min_required) as u64;
    event::emit(ExcessWithdrawn<T> { pool_id: pool.id.to_inner(), org: pool.org, amount: withdrawable });
    coin::from_balance(pool.balance.split(withdrawable), ctx)
}

entry fun withdraw_excess_and_keep<T>(pool: &mut StreamPool<T>, ctx: &mut TxContext) {
    let coin = withdraw_excess(pool, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

// Step 1: org nominates a new address. The transfer is NOT live until the new
// address calls accept_org_transfer. Org can cancel at any time before acceptance.
public fun propose_org_transfer<T>(pool: &mut StreamPool<T>, new_org: address, ctx: &TxContext) {
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(ctx.sender() == pool.org, ENotOrg);
    pool.pending_org = option::some(new_org);
    event::emit(OrgTransferProposed<T> { pool_id: pool.id.to_inner(), current_org: pool.org, proposed_to: new_org });
}

// Step 2: the nominated address accepts, committing the transfer.
public fun accept_org_transfer<T>(pool: &mut StreamPool<T>, ctx: &TxContext) {
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(option::is_some(&pool.pending_org), ENoPendingOrgTransfer);
    let new_org = *option::borrow(&pool.pending_org);
    assert!(ctx.sender() == new_org, ENotPendingOrg);
    let old_org = pool.org;
    pool.org = new_org;
    pool.pending_org = option::none();
    event::emit(OrgTransferred<T> { pool_id: pool.id.to_inner(), old_org, new_org });
}

// Org cancels a pending transfer before the nominee has accepted.
public fun cancel_org_transfer<T>(pool: &mut StreamPool<T>, ctx: &TxContext) {
    assert!(pool.version == VERSION, EWrongVersion);
    assert!(ctx.sender() == pool.org, ENotOrg);
    assert!(option::is_some(&pool.pending_org), ENoPendingOrgTransfer);
    pool.pending_org = option::none();
    event::emit(OrgTransferCancelled<T> { pool_id: pool.id.to_inner(), cancelled_by: ctx.sender() });
}

#[test_only]
public fun create_pool_for_testing<T>(ctx: &mut TxContext): StreamPool<T> { create_pool(4, ctx) }
