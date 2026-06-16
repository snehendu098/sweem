# Contract Architecture

Sweem is split into three Sui Move packages. Each has a single responsibility and a clearly defined upgrade surface.

---

## Package Overview

```
packages/
  sweem_core/       ← streaming logic + vault primitives
  sweem_adapters/   ← yield protocol integrations
  sweem_registry/   ← governance + protocol approval
```

### Dependency graph

```
sweem_core        ← no dependencies
sweem_registry    ← no dependencies
sweem_adapters    ← depends on sweem_core + sweem_registry
```

`sweem_core` sits at the bottom with zero upward dependencies. It never needs to change when a new yield protocol is added.

---

## Package Responsibilities

### `sweem_core`
Everything to do with streaming salary and vaults. Creates `StreamPool` objects, tracks employee streams, computes claimable amounts, handles pause/stop/resume, manages `EmployeeVault` and `TokenBucket` objects. Has no knowledge of any yield protocol.

→ Full details: [sweem_core.md](./sweem_core.md)

### `sweem_adapters`
One module per yield protocol. Each module knows how to deposit into and withdraw from that specific protocol on behalf of either a `StreamPool` (org side) or a `TokenBucket` (employee side). Checks `sweem_registry` on every call to verify the protocol is approved before touching any funds.

→ Full details: [sweem_adapters.md](./sweem_adapters.md)
→ Protocol specs: [../protocols/](../protocols/)

### `sweem_registry`
Holds the `AdminCap`, the `ProtocolRegistry` (approved yield protocols list), and `ProtocolConfig` (fee rates and treasury address). Acts as a security gate and fee configuration source — adapter functions check protocol approval here, and `sweem_core::claim` reads fee rates from here at runtime.

→ Full details: [sweem_registry.md](./sweem_registry.md)

---

## Key Design Decisions

**`claim` returns `Coin<T>`, not transfers it**
This is what makes the entire PTB composition work. The employee gets a `Coin<T>` back from `claim`, then the PTB freely routes it — split between vault and wallet, swap to different tokens, deposit into yield protocols — all in one atomic transaction.

**`pool_withdraw_*` is `public(package)` — reached only through gated wrappers**
The raw yield-withdrawal functions are not callable directly from outside `sweem_adapters`. They are reached through two `public` wrappers, each with its own bound, so no one can arbitrarily drain the org's yield positions:
- `cover_claim_from_<protocol>` (employee) — withdraws at most the **caller's own** claim shortfall (`claimable_amount(pool, ctx.sender()) − idle cash`); a non-employee draws nothing. Bounded by the caller's claimable, so it's safe to be public.
- `org_withdraw_<protocol>` (org-gated, `ctx.sender() == pool.org`) — lets the org unwind a position to idle for rebalancing.
`pool_invest_*` remains org-only.

**Claim entry points**
Employees call a `sweem_adapters` claim path, not `sweem_core::stream_pool::claim` directly: a dedicated single-protocol entry (`claim_with_liquidity` for Navi, `claim_with_liquidity_scallop` for Scallop), or — for a pool split across protocols — a PTB chaining `cover_claim_from_<protocol>` calls before a terminal `claim`. Each covers the shortfall from its protocol; the frontend chooses which protocols and in what order to draw from (no hardcoded priority). This keeps `sweem_core` completely yield-agnostic.

**Dynamic min-claim prevents spam**
`claim` enforces a minimum computed inline from the employee's own rate: `slice_per_ms * 604_800_000 / 10` (10% of their weekly income). No stored config needed — the threshold scales automatically with each employee's salary and updates whenever the org changes their `slice_per_ms`. Aborts with `EBelowMinClaimAmount` if not met.

**Registry is the security gate, adapters are the implementation**
The registry answers "is this protocol allowed?" — it cannot move a single token. The adapters know how to talk to each protocol — they have no authority of their own. Both are required. A compromised frontend cannot route funds to an unapproved contract because the adapter function aborts on the registry check before any money moves.

**`streams` stored in `Table<address, Stream>`**
O(1) lookup by employee address. More efficient than a `vector` for payment groups with many employees.

**`TokenBucket` is a dynamic object field**
`TokenBucket` needs its own `UID` so yield positions can be attached to it as dynamic fields. Only objects with a `UID` can have dynamic fields. Plain dynamic field values cannot.

**Org auth = address check, not a cap object**
`ctx.sender() == pool.org` inside the function. No per-pool `OrgCap` object is needed — that would create O(N) objects for an org with N payment groups and add unnecessary overhead.

**`public(package)` for internal helpers**
Internal helpers used only within the package use `public(package)` instead of `public`. This keeps their signatures changeable in future upgrades and prevents external packages from building dependencies on them.

**Revenue model: deposit fee on org funding, yield fees on unwound positions**
`sweem_core::deposit` and `topup` deduct a deposit fee (bps on gross amount) before crediting `StreamPool` — org pays upfront, employees receive full salary at claim time. `sweem_adapters` pool and vault withdrawal functions deduct yield fees (bps on yield portion only) when positions are unwound. All three rates live in `ProtocolConfig` inside `sweem_registry` and are updated by the admin without any package upgrade. See [../revenue/revenue.md](../revenue/revenue.md) for full details.

---

## Upgrade Strategy

| Package | How often it changes | Upgrade policy | UpgradeCap custody |
|---|---|---|---|
| `sweem_core` | Rarely — only for critical streaming logic fixes | Compatible | Multisig, 48h timelock |
| `sweem_adapters` | When new protocols are added | Additive (new modules only) | Multisig |
| `sweem_registry` | Rarely — only if governance model changes | Compatible | Multisig, 48h timelock |

Adding a new yield protocol touches only `sweem_adapters` (new module) and `sweem_registry` (one `add_protocol` call). `sweem_core` is never touched.

---

## Adding a New Yield Protocol

```
1. Research the protocol → write docs/protocols/<name>.md
2. Write sweem_adapters::<name> module (4 functions: pool_invest, pool_withdraw, vault_invest, vault_withdraw)
3. Upgrade sweem_adapters (additive — new module only, nothing existing changes)
4. Call registry::add_protocol(registry, &admin_cap, "<name>", adapter_pkg_address, yield_type)
5. Frontend reads registry::protocols_by_type → new protocol appears automatically
```

---

## PTB Flow — End to End

### Org funds a payment group and routes yield

```
1. sweem_core::stream_pool::deposit      → funds StreamPool, sets up streams
2. sweem_adapters::<protocol>::pool_invest → routes portion of pool to yield protocol
   (repeat step 2 for each protocol in the allocation)
```

### Employee claims salary, splits between vault and wallet

```
1. sweem_adapters::claim_liquidity::claim_with_liquidity → withdraws from yield positions if needed, returns Coin<T>
2. PTB splitCoins                                        → splits into vault portion + wallet portion
3. sweem_core::employee_vault::deposit_to_bucket         → vault portion into TokenBucket
4. sweem_adapters::<protocol>::vault_invest               → routes per vault allocation
   (repeat step 4 for each protocol in the vault strategy)
5. PTB transferObjects                                   → wallet portion sent to employee address
```

All steps in one atomic transaction. If any step fails, everything reverts.

---

## Object Summary

| Object | Type | Owner | Package |
|---|---|---|---|
| `StreamPool<T>` | Shared | — | sweem_core |
| `EmployeeVault` | Owned | Employee wallet | sweem_core |
| `TokenBucket<T>` | Dynamic object field on vault | — | sweem_core |
| `AdminCap` | Owned | Sweem team multisig | sweem_registry |
| `ProtocolRegistry` | Shared | — | sweem_registry |
| `ProtocolConfig` | Shared | — | sweem_registry |
| `PendingAdminTransfer` | Owned | Proposed new admin | sweem_registry |
