# Adding a New Yield Protocol

The adapter system is designed so each protocol is a separate module in `sweem_adapters`. Adding Scallop, an LST, or any other protocol follows the same pattern.

---

## Step 1 — Register in sweem_registry

Call `add_protocol` with the `AdminCap`:

```
add_protocol(registry, cap, "scallop", <adapter_package_address>, 0)
// yield_type: 0 = Lending, 1 = Yield-bearing stablecoin, 2 = LST
```

This enables the protocol. Any adapter function checks `is_approved(registry, &name)` before calling external protocols, so disabling a protocol via `disable_protocol` immediately stops new fund flows.

---

## Step 2 — Add a dependency in Move.toml

```toml
[dependencies]
scallop_core = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "...", rev = "main" }
```

Or a local stub for testnet. The dep alias doesn't matter — what matters is the package name declared inside that repo's own `Move.toml` (that's what you use in `use` statements).

---

## Step 3 — Write a new module in sweem_adapters/sources/

Minimal shape for a lending adapter:

```move
module sweem_adapters::scallop;

use scallop_core::...; // real protocol types
use sweem_core::stream_pool::{StreamPool, split_balance_for_invest, merge_balance_from_yield, borrow_uid_mut};
use sweem_core::employee_vault::{EmployeeVault, borrow_bucket_mut, split_bucket_for_invest, merge_bucket_from_yield, bucket_uid_mut};
use sweem_registry::registry::{ProtocolRegistry, ProtocolConfig, is_approved, org_yield_fee_bps, vault_yield_fee_bps, treasury};
use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;

const PROTOCOL_NAME: vector<u8> = b"scallop";

// Key structs for DF/DOF storage on pool/vault UIDs
public struct ScallopPoolCapKey() has copy, drop, store;
public struct ScallopPoolPositionKey() has copy, drop, store;
// ...

// Position tracks deposited principal for yield fee calc
public struct ScallopPosition has store { deposited_value: u64 }

// One-time setup: org/employee stores their protocol cap into pool/vault
public fun store_pool_cap(...) { ... }

// Core invest/withdraw pair
public fun pool_invest_scallop<T>(...) {
    assert!(is_approved(registry, &std::string::utf8(PROTOCOL_NAME)), EProtocolNotApproved);
    // call protocol deposit
    // update ScallopPosition DF
    // emit event
}

public(package) fun pool_withdraw_scallop<T>(...) {
    // withdraw, calc yield fee, send to treasury
    // update position
}

// Employee-side claim helper — bounded by the CALLER'S own claimable shortfall.
// Safe to be public; composed in a PTB with other cover_claim_from_* + a final claim.
public fun cover_claim_from_scallop<T>(pool, ..., max_amount: u64, ctx) {
    let claimable = stream_pool::claimable_amount(pool, ctx.sender(), clock);
    let cash = stream_pool::balance_value(pool);
    if (cash < claimable) {
        let shortfall = claimable - cash;
        let draw = if (shortfall < max_amount) { shortfall } else { max_amount };
        if (draw > 0) { pool_withdraw_scallop<T>(..., draw, ctx); };
    };
}

// Org-gated unwind for rebalancing protocol -> idle -> another protocol.
public fun org_withdraw_scallop<T>(pool, ..., amount: u64, ctx) {
    assert!(stream_pool::org(pool) == ctx.sender(), ENotOrg);
    pool_withdraw_scallop<T>(..., amount, ctx);
}
```

Key rules:
- `pool_withdraw_*` stays `public(package)` — the package-internal primitive, never called by external callers directly
- Expose `cover_claim_from_<X>` (`public`, employee claim) and `org_withdraw_<X>` (`public`, org-gated rebalance) as the two external entry points — see Step 4
- Always check `is_approved` at entry
- Always track `deposited_value` so yield fee can be calculated as `gross - principal`
- Use block scopes `{ ... }` to release borrow before touching the same object again (Move borrow checker)
- `AccountCap`-style objects (key+store) go in `dof`. Position structs (store-only) go in `df`.

---

## Step 4 — Expose two external entry points (no central module to edit)

A claim or rebalance can span any mix of protocols (L + Y + S). Because each protocol needs different typed object arguments, Move cannot express one generic "claim over N protocols" function — so the system is **PTB-composed**, not centrally dispatched. Adding a protocol therefore means adding **two `public` functions in your new module and editing nothing else**:

**1. `cover_claim_from_<X>` (employee claim).** Reads the caller's own `claimable_amount`, and if idle cash is short, pulls up to `max_amount` of the shortfall out of the protocol into `pool.balance`. It does **not** claim. The amount is bounded by the caller's own claimable, so it is safe to be `public` — non-employees and over-draws are no-ops (no grief vector). The employee's claim PTB chains one call per protocol the pool uses, then a terminal `stream_pool::claim` (which asserts overall sufficiency):

```
PTB:
  cover_claim_from_navi(...)      // L
  cover_claim_from_scallop(...)   // L
  cover_claim_from_volo(...)      // S  (future)
  stream_pool::claim(...)         // pays out from idle balance
```

**2. `org_withdraw_<X>` (org rebalance).** Org-gated unwind of `amount` back to idle cash. The org composes a rebalance PTB: `org_withdraw_navi(x)` → `pool_invest_scallop(x)` atomically.

This replaces the older approach of editing a shared `claim_liquidity` module. The single-protocol convenience entries (`claim_with_liquidity`, `claim_with_liquidity_scallop`) remain for pools that use exactly one protocol.

---

## LST Example (yield_type = 2)

For LSTs (e.g. converting SUI → haSUI via Haedal), the pattern is different — there's no AccountCap or position tracking. Instead:

```move
// "invest" = swap SUI → haSUI (or similar)
public fun pool_invest_haedal<SUI>(pool, haedal_staking, amount, ...) {
    let sui_bal = split_balance_for_invest(pool, amount, ctx);
    let haSUI = haedal_staking::mint(haedal_staking, sui_bal, ctx);
    // store haSUI as DOF on pool UID
}

// "withdraw" = redeem haSUI → SUI
public(package) fun pool_withdraw_haedal<SUI>(pool, haedal_staking, amount, ...) {
    let haSUI = dof::borrow_mut(...);
    let sui_bal = haedal_staking::redeem(haedal_staking, haSUI, ctx);
    // calc yield on the difference, send fee, merge back
}
```

---

## Summary

| To add a protocol | Steps |
|---|---|
| New lending (Scallop, etc.) | Add dep → write module following Navi pattern → register in registry (yield_type=0) |
| New LST | Add dep → write module with mint/redeem pattern → register as yield_type=2 |
| New yield-bearing stablecoin | Similar to LST pattern (swap in, swap out) → yield_type=1 |

Every protocol adds the same five functions in its own module — `pool_invest_<X>`, `pool_withdraw_<X>` (`public(package)`), `vault_invest_<X>`, `vault_withdraw_<X>`, plus the two external entries `cover_claim_from_<X>` and `org_withdraw_<X>`. **No edits to `stream_pool`, `employee_vault`, `registry`, or any other adapter.** Positions coexist because each adapter uses its own DF/DOF key types, so one pool or bucket can hold L + Y + S simultaneously without collision. A claim across all three is just a longer PTB chain.
