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
```

Key rules:
- `pool_withdraw_*` must be `public(package)` — it's called by `claim_liquidity`, not external callers
- Always check `is_approved` at entry
- Always track `deposited_value` so yield fee can be calculated as `gross - principal`
- Use block scopes `{ ... }` to release borrow before touching the same object again (Move borrow checker)
- `AccountCap`-style objects (key+store) go in `dof`. Position structs (store-only) go in `df`.

---

## Step 4 — Update claim_liquidity

`claim_liquidity.move` currently only handles Navi as the fallback liquidity source. To support multiple protocols:

```move
// Simple priority fallback: try Navi first, then Scallop
if (shortfall > 0 && dof::exists(borrow_uid(pool), NaviPoolCapKey())) {
    pool_withdraw_navi<T>(..., shortfall, ctx);
    shortfall = claimable - stream_pool::balance_value(pool);
};
if (shortfall > 0 && dof::exists(borrow_uid(pool), ScallopPoolCapKey())) {
    pool_withdraw_scallop<T>(..., shortfall, ctx);
};
```

Or implement a more sophisticated routing strategy off-chain and call specific withdraw functions from a PTB.

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
| New lending (Scallop, etc.) | Add dep → write module following Navi pattern → register in registry → update claim_liquidity |
| New LST | Add dep → write module with mint/redeem pattern → register as yield_type=2 |
| New yield-bearing stablecoin | Similar to LST pattern (swap in, swap out) → yield_type=1 |
