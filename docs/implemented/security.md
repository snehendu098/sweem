# Security

Sweem uses two OpenZeppelin packages to harden the protocol against arithmetic overflow and unauthorized access.

---

## OZ Math — Overflow-Safe Arithmetic

**Package:** `openzeppelin_math` (`math/core` subdir of `contracts-sui`)  
**Used in:** `sweem_core::stream_pool`, `sweem_adapters::navi`

### What was the risk

Raw `*` and `/` in Move silently overflow or underflow for u64. Affected code:
- Fee calculation: `gross * fee_bps / 10_000` — could overflow for large deposits
- Navi yield split: `pos_deposited * amount / gross` — both operands can be up to u64::MAX
- Min claim: `rate_amount * WEEK_MS / rate_period_ms / 10` — intermediate product overflows u64
- Claimable accrual: `elapsed * rate_amount / rate_period_ms` — product of two large values

### How it's fixed

**Fee multiplications** (`deposit_fee_bps`, `org_yield_fee_bps`, `vault_yield_fee_bps`) — replaced with OZ `mul_div`:

```move
let fee = oz_u64::mul_div(gross, fee_bps, 10_000, rounding::down())
    .destroy_or!(abort EArithmeticOverflow);
```

`mul_div` computes `a * b / c` using u128 internally and returns `Option<u64>` — `None` if the result overflows u64. `.destroy_or!(abort ...)` aborts the transaction cleanly.

**Navi principal_share** — product of two u64 values can exceed u64, so computed in u128:

```move
let r = oz_u128::mul_div(
    pos_deposited as u128, amount as u128, gross as u128, rounding::down()
).destroy_or!(abort EArithmeticOverflow);
let principal_share = r as u64;
```

**Claimable accrual** — uses `oz_u128::mul_div` to multiply before dividing (preserves precision for small rates like 100 USDC/month that would otherwise give zero):

```move
let new_earned = oz_u128::mul_div(
    elapsed as u128, stream.rate_amount, stream.rate_period_ms as u128, rounding::down()
).destroy_or!(abort EArithmeticOverflow) as u64;
let claimable = stream.pending_balance + new_earned;
```

The view function (`claimable_amount`) returns 0 instead of aborting on overflow, so frontends never get a failed devInspect.

---

## OZ AccessControl — Registry RBAC

**Package:** `openzeppelin_access` (`contracts/access` subdir of `contracts-sui`)  
**Used in:** `sweem_registry::registry`

### What was the risk

The previous `AdminCap` was a single capability object. Whoever held it had unrestricted access to all admin functions — fee setting, protocol management, and admin rotation all shared one key. No separation of concerns; no audit trail for who did what.

### How it's fixed

`AdminCap` replaced with `AccessControl<REGISTRY>` (OZ pattern). Admin authority is split into discrete roles:

| Role | Functions |
|---|---|
| `FeeManagerRole` | `set_fees`, `set_treasury` |
| `ProtocolManagerRole` | `add_protocol`, `enable_protocol`, `disable_protocol` |
| Default admin (root) | `grant_role`, `revoke_role`, `begin_default_admin_transfer` |

**In practice:** Sweem can give the fee key to the ops team and the protocol key to engineering, with neither able to act as the other. The root admin key (multisig) never needs to be used for routine operations.

**Admin rotation** is now handled by OZ's built-in `begin_default_admin_transfer` / `accept_default_admin_transfer` with a configurable time delay — replacing the hand-rolled propose/accept pattern.

**Shared object:** `AccessControl<REGISTRY>` is a shared object (not owned). This means no single wallet exclusively holds it — the roles table lives on-chain and any wallet with the right role can act, without moving objects around.

---

## StreamPool PauserRole — Delegated Pause Authority

**Where:** `sweem_core::stream_pool`  
**Why not OZ AccessControl:** OZ AccessControl requires an OTW (One-Time Witness), which is consumed once at module `init`. StreamPools are created dynamically by any org — each pool needs its own role table. OZ's pattern can't be applied per-pool; a custom bitmask is used instead.

### Design

Each `StreamPool` holds `delegated_roles: Table<address, u8>`. Roles are stored as bits:

```
PAUSER_ROLE = 0x01
```

The org always implicitly holds all bits. Other addresses need explicit grants.

### API

```move
// Grant pause/resume to an automation wallet
stream_pool::grant_pool_role(&mut pool, hr_wallet, stream_pool::pauser_role(), ctx);

// Revoke
stream_pool::revoke_pool_role(&mut pool, hr_wallet, stream_pool::pauser_role(), ctx);

// Check (always true for org)
stream_pool::has_pool_role(&pool, account, stream_pool::pauser_role());
```

### What PauserRole does NOT grant

- Cannot stop a stream (org-only, irreversible)
- Cannot deposit or topup
- Cannot access yield positions
- Cannot change stream rates

### Employee claim security

Employee claims are **not RBAC-gated** — they are math-gated. The claimable amount is calculated deterministically from `pending_balance + elapsed * rate_amount / rate_period_ms`. No role can inflate it or redirect the output coin. `claim` pays `ctx.sender()` what the formula says, period.

---

## Retroactive Rate Manipulation — Crystallization

**Risk:** An org could call `deposit` to lower an employee's `rate_amount` just before they claim, retroactively reducing earnings already accrued.

**Fix:** On every re-deposit for an existing stream, the contract crystallizes the earnings accrued at the old rate into `stream.pending_balance` before overwriting the rate:

```move
let earned = oz_u128::mul_div(elapsed, old_rate_amount, old_rate_period_ms, down()) as u64;
stream.pending_balance = stream.pending_balance + earned;
stream.claimed_at = now;        // clock reset — new rate applies only from this point forward
stream.rate_amount = new_rate;
```

`pending_balance` is always included in `claimable_amount` and paid out on `claim`. A rate change can only affect future earnings.

---

## Zero Rate Period Validation

**Risk:** `rate_period_ms = 0` would cause division-by-zero at claim time (caught by `oz_u128::mul_div` returning `None`), but the stream would be unusable and the employee could never claim.

**Fix:** `deposit` asserts `rate_period_ms > 0` for every employee entry:

```move
assert!(rate_period_ms > 0, EInvalidRatePeriod);
```

The transaction aborts immediately rather than creating a broken stream.

---

## Configurable Coverage Floor

**Risk:** An org could deposit a trivially small amount and invest all of it into a lending protocol, leaving zero idle cash. Every employee claim would revert with `EInsufficientPoolLiquidity` until the org tops up.

**Fix:** Each pool carries a `min_coverage_weeks: u64` field set at creation (must be ≥ 1). The coverage floor is enforced in three places — not just at deposit:

```move
let min_required = pool.total_weekly_committed * (pool.min_coverage_weeks as u128);

// 1. End of deposit — must hold enough after new funds land
assert!(pool.balance.value() as u128 >= min_required, EInsufficientCoverage);

// 2. split_balance_for_invest — cannot invest the safety buffer
assert!((pool.balance.value() - amount) as u128 >= min_required, EInsufficientCoverage);

// 3. withdraw_excess — org can only pull what exceeds the floor
```

`total_weekly_committed` is a live `u128` maintained by `deposit` and `stop_stream`:

```
per_stream_weekly = ceil(rate_amount * WEEK_MS / rate_period_ms)
```

Orgs set their own floor based on their use case — a short project might choose 1 week; a long-term payroll contract might choose 52. There is no upper cap, allowing orgs to pre-fund years in advance.

---

## Two-Step Org Transfer

**Risk:** `transfer_org` was a single-step operation. A typo in the new org address would permanently lock the pool — no deposits, no stream management, no invest/withdraw — with no recovery path.

**Fix:** Replaced with a propose → accept flow backed by `pending_org: Option<address>` on the struct:

```move
propose_org_transfer(pool, new_org, ctx)  // org nominates; pool.pending_org set
accept_org_transfer(pool, ctx)            // nominee accepts; pool.org updated
cancel_org_transfer(pool, ctx)            // org cancels before acceptance
```

`pool.org` only changes at `accept_org_transfer`. The original org retains full control and can cancel at any time before the nominee accepts.

---

## Role Revoke No-Op Event Fix

**Risk:** `revoke_pool_role` emitted `PoolRoleRevoked` even when the target account had never held the role, creating false entries in off-chain audit trails.

**Fix:** The event emit is now inside the `if table::contains(...)` block — it only fires when a role bit was actually cleared:

```move
if (table::contains(&pool.delegated_roles, account)) {
    let bits = table::borrow_mut(&mut pool.delegated_roles, account);
    *bits = *bits & (role ^ 0xFF);
    event::emit(PoolRoleRevoked { ... });  // ← only here
};
```

---

## UID Access Control — Known Limitation

**Risk:** `borrow_uid_mut_yield` (stream_pool) and `bucket_uid_mut` (employee_vault) are `public` — any external package holding a `ProtocolRegistry` reference could call them to get a `&mut UID` on any pool or bucket, enabling arbitrary dynamic field manipulation.

**Why it can't be fixed with `public(package)`:** In Sui Move, `public(package)` restricts a function to callers within the same package at the same address. `sweem_adapters` is a separate package from `sweem_core` — it cannot call `public(package)` functions across the package boundary. These functions must remain `public` for adapters to work.

**Mitigations in place:**
- `borrow_uid_mut_yield` requires a valid `ProtocolRegistry` object (shared, on-chain — not forgeable)
- Adapters additionally check `is_approved(registry, protocol_name)` before any UID access
- The only fix would be merging `sweem_core` and `sweem_adapters` into one package, which sacrifices independent upgrade paths

---

## What is NOT in scope yet

- **Sub-millisecond precision** — the `fp_math` package (`math/fixed_point`) could enable fractional token accrual per ms. Deferred: the current `(rate_amount, rate_period_ms)` pair already avoids precision loss at claim time; sub-ms granularity adds complexity for marginal gain.
- **InvestorRole / Lending Aggregator** — orgs currently self-manage yield strategy via the UI (choose which protocol, see APR). A future aggregator will auto-route funds to the best yield source. No dead code added now.
- **Per-adapter RBAC** — the Navi adapter is org-gated at the function level (`assert!(org == ctx.sender())`). Fine for now; richer adapter roles (e.g. whitelisted rebalancers) can be added when aggregator work begins.
