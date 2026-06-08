# sweem_core

Handles all streaming logic and vault primitives. Has zero knowledge of yield protocols — it only moves tokens and tracks time. Never needs to change when a new yield protocol is added.

---

## Storage

### `StreamPool<phantom T>` — Shared Object

One per payment group token. `T` is the token type (e.g. `USDC`, `SUI`).

```
id:                   UID
version:              u64                    ← must equal package VERSION; checked on every mutating call
org:                  address                ← only org or delegated roles can manage streams
pending_org:          Option<address>        ← nominee during two-step org transfer; None when idle
total_deposited:      u64                    ← running total of all deposits (net of fee)
total_claimed:        u64                    ← running total of all employee claims
balance:              Balance<T>             ← raw uninvested tokens
streams:              Table<address, Stream> ← keyed by employee wallet address
delegated_roles:      Table<address, u8>     ← bitmask of roles granted to non-org addresses
total_weekly_committed: u128               ← sum of weekly rates across all active streams
min_coverage_weeks:   u64                    ← pool's own cash-coverage floor (≥ 1, set at creation)
```

Dynamic fields on StreamPool (managed by `sweem_adapters`):
```
"navi" → NaviPosition
```

Accounting invariant:
```
total_deposited - total_claimed = balance + sum(all yield position values)
```

---

### `Stream` — stored inside `StreamPool.streams`

Not an independent object. Lives inside the Table keyed by employee address.

```
employee:         address
rate_amount:      u128        ← tokens earned per rate_period_ms (covers 18-decimal tokens)
rate_period_ms:   u64         ← the period over which rate_amount is earned (e.g. 2_592_000_000 = 30 days)
pending_balance:  u64         ← crystallized earnings from before a rate change; added to claimable
started_at:       u64         ← stream creation timestamp, set once, never changes
claimed_at:       u64         ← timestamp of last claim (Clock ms), resets on every claim
total_paused_ms:  u64         ← cumulative paused time since last claim, resets on claim
paused_at:        Option<u64> ← Some = currently paused since this timestamp
stopped_at:       Option<u64> ← Some = permanently stopped at this timestamp
```

**State machine:**
```
ACTIVE  → paused_at = None,     stopped_at = None
PAUSED  → paused_at = Some(ts), stopped_at = None
STOPPED → paused_at = None,     stopped_at = Some(ts)
```

**Claimable formula:**
```
effective_end = paused_at ?? stopped_at ?? current_clock_ms
new_earned    = (effective_end - claimed_at - total_paused_ms) * rate_amount / rate_period_ms
claimable     = pending_balance + new_earned
```
Division is deferred to claim time via `oz_u128::mul_div(elapsed, rate_amount, rate_period_ms)` — multiplying before dividing preserves full precision for small rates.

---

## PauserRole — Delegated Stream Control

Orgs can delegate the ability to pause and resume streams to other addresses (e.g. an HR automation tool, a Sweem backend wallet) without exposing their main wallet key.

**Role constant:**
```move
const PAUSER_ROLE: u8 = 0x01;
```

Roles are stored as a bitmask per address in `delegated_roles: Table<address, u8>`. The org always implicitly holds all roles — a delegated address only needs the specific bits it was granted.

### Delegation functions

```move
// Grant PAUSER_ROLE to an address (org only)
public fun grant_pool_role<T>(pool: &mut StreamPool<T>, account: address, role: u8, ctx: &TxContext)

// Revoke specific bits from an address (org only)
public fun revoke_pool_role<T>(pool: &mut StreamPool<T>, account: address, role: u8, ctx: &TxContext)

// Check if an account holds a role (org always returns true)
public fun has_pool_role<T>(pool: &StreamPool<T>, account: address, role: u8): bool

// Convenience constant getter
public fun pauser_role(): u8
```

### What PauserRole gates

| Function | Auth check |
|---|---|
| `pause_stream` | `has_pool_role(pool, sender, PAUSER_ROLE)` |
| `resume_stream` | `has_pool_role(pool, sender, PAUSER_ROLE)` |
| `stop_stream` | org only (no delegation) |
| `deposit`, `topup` | org only (no delegation) |
| `claim` | employee only (no RBAC, math-enforced) |

### Events

```
PoolRoleGranted: { pool_id: ID, account: address, role: u8 }
PoolRoleRevoked: { pool_id: ID, account: address, role: u8 }  ← only emitted when role was actually held
```

---

## Module: `stream_pool`

### `create_pool<T>`
```
public fun create_pool<T>(min_coverage_weeks: u64, ctx: &mut TxContext): StreamPool<T>
entry fun create_and_share<T>(min_coverage_weeks: u64, ctx: &mut TxContext)
```
Creates pool with `delegated_roles: table::new(ctx)` initialized. `min_coverage_weeks` sets how many weeks of committed payroll must remain as idle cash at all times — enforced at deposit and invest time. Must be ≥ 1; no upper cap (orgs may pre-fund years upfront).

---

### `deposit<T>`
```
public fun deposit<T>(
    pool:            &mut StreamPool<T>,
    config:          &ProtocolConfig,
    payment:         Coin<T>,
    employees:       vector<address>,
    rate_amounts:    vector<u128>,
    rate_periods_ms: vector<u64>,
    clock:           &Clock,
    ctx:             &mut TxContext,
)
```
**Algo:**
1. Assert `ctx.sender() == pool.org`
2. Assert all three vectors have equal length
3. Fee: `oz_u64::mul_div(gross, fee_bps, 10_000, rounding::down())`
4. Send fee to `config.treasury`, merge net into `pool.balance`
5. For each employee:
   - Assert `rate_period_ms > 0` (`EInvalidRatePeriod`)
   - If stream exists: crystallize accrued earnings into `pending_balance` at old rate, then update rate
   - If new: create `Stream` with `pending_balance = 0`

---

### `topup<T>`
Adds funds without touching streams. Same fee logic as `deposit`.

---

### `claim<T>`
```
public fun claim<T>(pool: &mut StreamPool<T>, clock: &Clock, ctx: &mut TxContext): Coin<T>
```
Employee-only. Claimable calculated via `oz_u128::mul_div` to prevent overflow:
```move
let new_earned = oz_u128::mul_div(elapsed as u128, rate_amount, rate_period_ms as u128, down())
    .destroy_or!(abort EArithmeticOverflow) as u64;
let claimable = stream.pending_balance + new_earned;
```
Min claim enforced: 10% of weekly income at current rate (`WEEK_MS * rate_amount / rate_period_ms / 10`). Bypassed when `pending_balance > 0` so a rate change never locks up crystallized earnings.

---

### `pause_stream<T>` / `resume_stream<T>`
```
public fun pause_stream<T>(pool, employee, clock, ctx)
public fun resume_stream<T>(pool, employee, clock, ctx)
```
Auth: `has_pool_role(pool, ctx.sender(), PAUSER_ROLE)` — org or any address with PAUSER_ROLE.

---

### `stop_stream<T>`
```
public fun stop_stream<T>(pool, employee, clock, ctx)
```
Auth: org only. Irreversible — sets `stopped_at`. Employee can still claim earned-so-far.

---

### `claimable_amount<T>` — read-only
```
public fun claimable_amount<T>(pool, employee, clock): u64
```
Returns 0 on overflow (safe view — no abort).

---

## Module: `employee_vault`

### `create_vault`
```
public fun create_vault(ctx: &mut TxContext): EmployeeVault
entry fun create_and_keep(ctx: &mut TxContext)
```

---

### `init_bucket<T>`
Opens a `TokenBucket<T>` slot in the vault. Employee only.

---

### `deposit_to_bucket<T>` / `withdraw_from_bucket<T>`
Employee only. Standard balance operations.

---

### Org transfer — two-step

Org authority is transferred via a propose → accept flow to prevent permanent lockout from typos.

```move
// Step 1: org nominates a new address (reversible until accepted)
public fun propose_org_transfer<T>(pool, new_org: address, ctx)

// Step 2: the nominated address accepts and becomes org
public fun accept_org_transfer<T>(pool, ctx)

// Org cancels a pending nomination before it is accepted
public fun cancel_org_transfer<T>(pool, ctx)
```

`pool.pending_org` holds the nominee. `pool.org` only changes on `accept_org_transfer`. The original org retains full control until then and can cancel at any time.

---

### Yield hooks

```
// org-gated; enforces min_coverage_weeks floor on remaining cash after split
split_balance_for_invest(pool, amount, ctx) → Balance<T>

// ungated; merges returned yield back into pool balance
merge_balance_from_yield(pool, balance)

// org-gated
borrow_uid_mut(pool, ctx) → &mut UID

// registry-gated; used by adapters during claim/withdraw
// must stay public — sweem_adapters is a separate package and cannot call public(package) functions
borrow_uid_mut_yield(pool, registry) → &mut UID
```

Vault equivalents:
```
split_bucket_for_invest(bucket, amount) → Balance<T>
merge_bucket_from_yield(bucket, balance)
vault_uid_mut(vault, ctx) → &mut UID
bucket_uid_mut(bucket, registry) → &mut UID   ← registry-gated; must stay public (cross-package)
```

---

## Errors

```
// stream_pool
ENotOrg
EStreamNotFound
EStreamAlreadyStopped
EStreamNotPaused
EStreamNotActive
EInsufficientBalance
EZeroClaimable
EEmployeeArrayMismatch
EBelowMinClaimAmount
EArithmeticOverflow        ← OZ math / u128 overflow guard
EInvalidRatePeriod         ← rate_period_ms == 0 rejected on deposit
EWrongVersion              ← pool.version != VERSION; call migrate first
EInsufficientCoverage      ← balance would fall below min_coverage_weeks floor
ENoWithdrawableBalance     ← no excess above coverage floor to withdraw
EInvalidCoverageWeeks      ← min_coverage_weeks < 1
ENoPendingOrgTransfer      ← accept/cancel called with no pending nomination
ENotPendingOrg             ← accept called by wrong address

// employee_vault
EVaultNotOwner
EBucketNotFound
EBucketAlreadyExists
EInsufficientBucketBal
```

---

## Events

```
PoolFunded<phantom T>:          { pool_id, org, gross, fee, net, timestamp }
StreamCreated<phantom T>:       { pool_id, employee, rate_amount, rate_period_ms, started_at }
PoolToppedUp<phantom T>:        { pool_id, org, gross, fee, net }
FundsClaimed<phantom T>:        { pool_id, employee, amount, timestamp }
StreamPaused<phantom T>:        { pool_id, employee, paused_at }
StreamResumed<phantom T>:       { pool_id, employee, resumed_at }
StreamStopped<phantom T>:       { pool_id, employee, stopped_at }
PoolRoleGranted:                { pool_id, account, role }
PoolRoleRevoked:                { pool_id, account, role }   ← only emitted when role was held
OrgTransferProposed<phantom T>: { pool_id, current_org, proposed_to }
OrgTransferred<phantom T>:      { pool_id, old_org, new_org }
OrgTransferCancelled<phantom T>:{ pool_id, cancelled_by }
ExcessWithdrawn<phantom T>:     { pool_id, org, amount }
```
