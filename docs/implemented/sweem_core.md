# sweem_core

`contracts/packages-mainnet/sweem_core/sources/`

Two modules: `stream_pool` (org-side payroll) and `employee_vault` (employee-side yield).

---

## StreamPool

A shared object created by an org. Holds the payroll balance and a table of `Stream` entries per employee.

```
StreamPool<T> {
    version: u64                          // must equal package VERSION on every mutating call
    org: address
    pending_org: Option<address>          // nominee during two-step transfer; None when idle
    total_deposited: u64
    total_claimed: u64
    balance: Balance<T>
    streams: Table<address, Stream>
    delegated_roles: Table<address, u8>   // bitmask of per-address role grants
    total_weekly_committed: u128          // sum of weekly rates across all active streams
    min_coverage_weeks: u64              // cash-coverage floor set at pool creation (≥ 1)
}

Stream {
    rate_amount: u128          // tokens earned per rate_period_ms (u128 covers 18-decimal tokens)
    rate_period_ms: u64        // period for rate_amount (e.g. 2_592_000_000 = 30 days)
    pending_balance: u64       // crystallized earnings from before a rate change
    started_at: u64
    claimed_at: u64            // timestamp of last successful claim
    total_paused_ms: u64       // cumulative paused time excluded from earnings
    paused_at: Option<u64>
    stopped_at: Option<u64>
}
```

### Claimable amount formula

```
effective_end = paused_at ?? stopped_at ?? current_clock_ms
new_earned    = (effective_end - claimed_at - total_paused_ms) * rate_amount / rate_period_ms
claimable     = pending_balance + new_earned
```

Overflow-safe: `oz_u128::mul_div(elapsed, rate_amount, rate_period_ms)` multiplies before dividing, preserving precision for small rates (e.g. 100 USDC/month). Returns 0 in the view function; aborts in the mutating `claim` function.

The minimum claim is 10% of a full week's earnings at the current rate, to prevent dust spam. Bypassed when `pending_balance > 0`.

### Deposit flow

`create_and_share<T>(min_coverage_weeks: u64, ctx)` — org passes their desired coverage floor at creation; must be ≥ 1; no upper cap.

`deposit(pool, config, payment, employees, rate_amounts: vector<u128>, rate_periods_ms: vector<u64>, clock, ctx)`

1. Takes deposit fee from payment — computed with `oz_u64::mul_div` (overflow-safe)
2. Transfers fee to `treasury`
3. Adds net amount to pool balance
4. For each employee:
   - Asserts `rate_period_ms > 0` (`EInvalidRatePeriod`)
   - If stream exists: crystallizes accrued earnings into `pending_balance` at old rate, then updates rate
   - If new: creates `Stream` with `pending_balance = 0`

`topup(pool, config, payment, ctx)` — adds funds without touching streams.

### Stream lifecycle

| Function | Who can call | What it does |
|---|---|---|
| `pause_stream` | org or PauserRole | Records `paused_at`, starts accumulating `total_paused_ms` |
| `resume_stream` | org or PauserRole | Adds elapsed time to `total_paused_ms`, clears `paused_at` |
| `stop_stream` | org only | Sets `stopped_at`, employee can still claim earned-so-far |
| `claim` | employee | Transfers claimable amount to caller |

**Frontend wiring:** the org Payroll screen (`fe/components/dashboard/sweem/payroll-screen.tsx`) renders a per-employee **Pause / Resume** button in the streams table. The button calls `pauseStreamTx` / `resumeStreamTx` (`fe/lib/tx.ts`) and the status badge (`Streaming` / `Paused` / `Stopped`) is driven by `readStreamStatuses`, which batch-reads each stream's `paused_at` / `stopped_at` from the pool's `streams` Table. While paused, the row's live ticker freezes to mirror on-chain accrual.

### PauserRole delegation

Orgs can delegate pause/resume authority to other addresses without giving them org-level access:

```move
// Delegate pause/resume to an address
stream_pool::grant_pool_role(&mut pool, account, stream_pool::pauser_role(), ctx);

// Revoke delegation
stream_pool::revoke_pool_role(&mut pool, account, stream_pool::pauser_role(), ctx);

// Check (org always returns true)
stream_pool::has_pool_role(&pool, account, stream_pool::pauser_role());
```

Roles are stored as a u8 bitmask per address in `delegated_roles`. Only `PAUSER_ROLE = 0x01` exists — future roles can be added by using additional bits.

**Use case:** grant PAUSER_ROLE to Sweem's backend wallet so it can pause a stream when an org cancels their subscription, without the org needing to be online for the transaction.

### Org transfer — two-step

`transfer_org` is replaced by a propose → accept pattern to protect against permanent lockout from a typo:

```move
propose_org_transfer(pool, new_org, ctx)  // org nominates; pool.pending_org = Some(new_org)
accept_org_transfer(pool, ctx)            // nominee accepts; pool.org updated, pending_org cleared
cancel_org_transfer(pool, ctx)            // org cancels; pending_org cleared, no change to org
```

`pool.org` only changes at `accept_org_transfer`. The original org retains full control and can cancel at any time before acceptance.

---

### Yield hooks

- `split_balance_for_invest(pool, amount, ctx) → Balance<T>` — org-gated; enforces coverage floor on remaining cash
- `merge_balance_from_yield(pool, balance)` — ungated; returns gross proceeds back into pool
- `borrow_uid_mut(pool, ctx) → &mut UID` — org-gated; used by adapters at invest time
- `borrow_uid_mut_yield(pool, registry) → &mut UID` — registry-gated; used by adapters during claim/withdraw; must remain `public` because `sweem_adapters` is a separate package (`public(package)` does not cross package boundaries in Sui Move)

---

## Scallop Claim Flow

When an org has invested pool funds into Scallop, employee claims do not fail — the protocol withdraws from Scallop on demand.

### How it works

`claim_with_liquidity_scallop` (in `sweem_adapters`) handles this transparently:

1. Computes claimable amount from on-chain `Stream` state
2. Checks pool idle cash (`StreamPool.balance`)
3. If `cash < claimable`, computes `shortfall = claimable - cash` and calls `pool_withdraw_scallop`
4. `pool_withdraw_scallop` reads the current Scallop exchange rate on-chain, splits the exact fraction of sCoin needed, redeems it for USDC, deducts the yield fee, and merges USDC back into the pool
5. Asserts `pool.balance >= claimable` — transaction aborts if Scallop returned less than needed
6. Calls `stream_pool::claim` — employee receives USDC, `claimed_at` is updated

The remaining sCoin position **stays invested** in Scallop. Only the minimum needed is redeemed.

### PTB composition

- **Org deposit PTB:** `deposit(...)` → `pool_invest_scallop(...)` — funds deposited then immediately invested
- **Employee claim PTB:** single call to `claim_with_liquidity_scallop(...)` — Scallop withdrawal is embedded

### What happens if the pool is broke

If both idle cash and the Scallop position are insufficient, `pool_withdraw_scallop` redeems the full sCoin and still falls short. The final `assert!(balance >= claimable)` aborts with `EInsufficientPoolLiquidity`. The stream keeps ticking — backpay accrues until the org tops up.

---

## Coverage Floor (`min_coverage_weeks`)

Each pool enforces its own configurable cash-coverage floor. The org sets this at creation — it controls how many weeks of committed payroll must always remain as idle cash in the pool.

### On-chain field

`StreamPool` carries `total_weekly_committed: u128` — the sum of weekly earning rates across all active streams:

```
per_stream_weekly = ceil(rate_amount * WEEK_MS / rate_period_ms)
total_weekly_committed = sum(per_stream_weekly) for all ACTIVE streams
```

Kept in sync automatically:
- New stream created → add stream's weekly rate
- Stream rate updated (re-deposit) → subtract old, add new
- Stream stopped → subtract that stream's weekly rate

### Where the check fires

The same floor is enforced in three places:

**1. At the end of `deposit`:**
```move
let min_required = pool.total_weekly_committed * (pool.min_coverage_weeks as u128);
assert!(pool.balance.value() as u128 >= min_required, EInsufficientCoverage);
```

**2. Inside `split_balance_for_invest` (before moving funds to a lending protocol):**
```move
assert!((pool.balance.value() - amount) as u128 >= min_required, EInsufficientCoverage);
```
Prevents orgs from investing the safety buffer — idle cash after invest must still meet the floor.

**3. Inside `withdraw_excess`:**
The org can only withdraw what is above `min_required`.

### Choosing `min_coverage_weeks`

| Use case | Recommended value |
|---|---|
| Short project (2–4 weeks) | 1 |
| Ongoing monthly payroll | 4 |
| Annual pre-funded contract | 52 or more |

No upper cap — orgs may set any value ≥ 1. A higher floor means more cash stays liquid; less can be invested for yield.

### What it does NOT protect

The check only enforces idle cash. If the org has invested funds into Navi or Scallop, those positions are not counted against the floor. Claims from invested pools work via `claim_with_liquidity` (partial redemption on demand). If both idle cash and all yield positions are insufficient, claims revert until the org tops up (see Solvency Model below).

---

## Solvency Model

### When the pool is healthy

Employee claims flow through `claim_with_liquidity_scallop` and complete in one transaction. Scallop redemption is automatic and transparent.

### When the org hasn't topped up

If `total earned > pool idle cash + Scallop position value`:

1. `claim_with_liquidity_scallop` aborts with `EInsufficientPoolLiquidity`
2. The employee's `claimed_at` is **not updated** — the transaction is atomic, nothing changes on failure
3. The stream keeps ticking — the owed amount continues to accumulate in `claimable_amount`
4. When the org tops up, the next successful claim pays out all backpay

### Backpay model

Sweem does not slash or cap earnings when a pool goes insolvent. The employee is owed everything the formula says, and it is paid out in full when funds are available again.

### Org responsibility

This is a B2B protocol. Orgs commit to employee payroll. The coverage floor enforces a minimum at deposit and invest time — after that, the notification layer provides reminders. See `docs/backend/notifications.md`.

---

## EmployeeVault

An owned object created by an employee. Multi-token: each token type lives in a separate `TokenBucket<T>` stored as a dynamic object field.

```
EmployeeVault {
    owner: address
    // TokenBucket<T> per token stored as DOF keyed by token_name String
}

TokenBucket<T> {
    balance: Balance<T>
    // yield adapter data (e.g. NaviPosition, NaviVaultCapKey) stored as DF/DOF on bucket's UID
}
```

### Basic operations

```
create_and_keep(ctx)                              // employee creates vault
init_bucket<T>(vault, token_name, ctx)            // open a new token slot
deposit_to_bucket<T>(vault, token_name, coin, ctx)
withdraw_from_bucket<T>(vault, token_name, amount, ctx)
```

### Yield hooks (package-internal)

- `borrow_bucket_mut<T>(vault, token_name) → &mut TokenBucket<T>`
- `split_bucket_for_invest<T>(bucket, amount) → Balance<T>`
- `merge_bucket_from_yield<T>(bucket, balance)`
- `bucket_uid_mut<T>(bucket) → &mut UID`
- `vault_uid_mut(vault) → &mut UID`
