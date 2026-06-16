# sweem_adapters

Handles all yield protocol integrations for both the org side (StreamPool) and the employee side (TokenBucket). Depends on `sweem_core` and `sweem_registry`. `sweem_core` has zero knowledge of this package.

Adding a new yield protocol = add a new module here + upgrade this package + add a registry entry. Core never changes.

---

## Dependencies

```
sweem_adapters → sweem_core     (borrows StreamPool, EmployeeVault, TokenBucket)
sweem_adapters → sweem_registry (checks protocol approval on every invest/withdraw)
```

---

## Storage

Position structs are plain dynamic fields (not objects) — `store` only, no `key`. They live as dynamic field values on `StreamPool` or `TokenBucket`, keyed by protocol name string.

Each protocol defines its own position struct. The exact fields depend on what each protocol returns — this is documented in `docs/protocols/*` once integration research is complete.

General shape:
```
<ProtocolName>Position: has store
  deposited_value: u64    ← original amount deposited, for accounting
  receipt_data:    ...    ← protocol-specific receipt info (receipt token amount, shares, etc.)
```

Dynamic field key convention (same on `StreamPool` and `TokenBucket`):
```
"<protocol_name>" → <ProtocolName>Position
```

---

## Module Structure

One module per yield protocol. Each module follows the same 4-function pattern:

| Function | Visibility | Scope | What it does |
|---|---|---|---|
| `pool_invest_<protocol><T>` | `public` | Org-only | Takes funds from `StreamPool.balance` → deposits to protocol → stores position |
| `pool_withdraw_<protocol><T>` | `public(package)` | Internal only | Reads position → withdraws from protocol → returns funds to `StreamPool.balance` |
| `vault_invest_<protocol><T>` | `public` | Employee-only | Takes funds from `TokenBucket.balance` → deposits to protocol → stores position |
| `vault_withdraw_<protocol><T>` | `public` | Employee-only | Reads position → withdraws from protocol → returns funds to `TokenBucket.balance` |

Every function:
- Calls `registry::is_approved(registry, "<protocol_name>")` and aborts if not approved

Auth rules:
- `pool_invest_*` — asserts `ctx.sender() == pool.org`. Only the org decides where to invest idle funds.
- `pool_withdraw_*` — `public(package)` visibility. Not callable externally. Only invoked internally by `claim_with_liquidity` in the same package, which withdraws exactly what is needed to cover the claimable amount. This prevents anyone from arbitrarily pulling funds out of yield and stopping the org's yield generation.
- `vault_invest_*` / `vault_withdraw_*` — asserts `vault.owner == ctx.sender()`.

---

## Planned Modules

| Module | Protocol | Type | Status |
|---|---|---|---|
| `scallop` | Scallop | L (Lending) | Pending protocol research |
| `navi` | Navi | L (Lending) | Pending protocol research |
| `usdy` | USDY (Ondo) | Y (Yield stablecoin) | Pending protocol research |
| `bucket` | Bucket | S (LST) | Pending protocol research |
| `aftermath` | Aftermath | S (LST) | Pending protocol research |

Each module will be fully specified in `docs/protocols/<protocol>.md` before implementation.

---

## Adding a New Yield Protocol

1. Research the protocol → write `docs/protocols/<name>.md`
2. Add a new module `<name>.move` with the 4-function pattern
3. Add a position struct to the `types` module
4. Upgrade `sweem_adapters` (additive — only new module added, nothing existing changes)
5. Call `sweem_registry::add_protocol(registry, &admin_cap, "<name>", pkg_address, yield_type)`
6. Frontend reads `registry::approved_protocols()` — new protocol appears automatically

`sweem_core` is never touched.

---

## Module: `claim_liquidity`

### Claim entry points

Because each protocol needs different statically-typed object arguments, there is **no single generic `claim_with_liquidity` that loops over all protocols** — Move can't take a heterogeneous list of protocol objects. The claim is instead either a dedicated single-protocol entry or a PTB-composed chain of per-protocol helpers.

**Single-protocol pool** — one dedicated entry per protocol (smallest object set):
```
claim_with_liquidity<T>(pool, storage, navi_pool, incentive_v2, incentive_v3, oracle, registry, config, clock, asset_id, ctx): Coin<T>   // Navi-only
claim_with_liquidity_scallop<T>(pool, version, market, registry, config, clock, ctx): Coin<T>                                            // Scallop-only
```
Each computes `claimable`, and if `pool.balance < claimable` withdraws the shortfall from its one protocol via `pool_withdraw_<protocol>`, asserts coverage, then delegates to `sweem_core::stream_pool::claim`.

**Split pool (multiple protocols)** — compose in one PTB. Each `cover_claim_from_<X>` tops up `pool.balance` from its protocol (bounded by the caller's own claim shortfall), then a terminal `stream_pool::claim` pays out and asserts coverage:
```
cover_claim_from_navi(...,    max_amount = navi_share)
cover_claim_from_scallop(..., max_amount = claimable)
stream_pool::claim(...)
```
The frontend chooses the source split and order (there is **no hardcoded L→Y→S priority** in the contract); each `cover_*` recomputes the remaining shortfall so the chain composes naturally. See `docs/implemented/sweem_adapters.md` → "Multi-Protocol Pools" for the full description and the `org_withdraw_<X>` rebalance path.

**Errors:**
```
EInsufficientPoolLiquidity  ← idle cash + withdrawn yield still < claimable (asserted in the single-protocol entries / by stream_pool::claim's EInsufficientBalance for the composed path)
```

---

## PTB Patterns

### Org: deposit + route to yield protocols

```typescript
// 1. Deposit funds to StreamPool
tx.moveCall({ target: `${CORE}::stream_pool::deposit`, ... });

// 2. Route portions to each approved protocol (one moveCall per protocol)
tx.moveCall({ target: `${ADAPTERS}::<protocol>::pool_invest_<protocol>`,
  arguments: [pool, registry, /* protocol objects */, amount] });
```

### Employee: claim + split between vault and wallet

```typescript
// 1. claim_with_liquidity → withdraws from yield positions if needed, returns Coin<T>
const [claimed] = tx.moveCall({
  target: `${ADAPTERS}::claim_liquidity::claim_with_liquidity`,
  arguments: [pool, registry, config, clock, /* protocol objects for invested protocols */]
});

// 2. Split: X% to vault, rest to wallet
const [vaultPortion, walletPortion] = tx.splitCoins(claimed, [vaultAmount]);

// 3. Deposit vault portion into bucket
tx.moveCall({ target: `${CORE}::employee_vault::deposit_to_bucket`,
  arguments: [vault, token_name, vaultPortion] });

// 4. Route per vault allocation (one moveCall per protocol)
tx.moveCall({ target: `${ADAPTERS}::<protocol>::vault_invest_<protocol>`,
  arguments: [vault, token_name, registry, /* protocol objects */, amount] });

// 5. Send wallet portion directly to employee
tx.transferObjects([walletPortion], sender);
```

All in one atomic PTB. `claim_with_liquidity` replaces the direct `sweem_core::claim` call — it handles liquidity sourcing transparently before the claim executes.

---

## Events

```
YieldInvested<phantom T>:  { object_id: ID, protocol: String, amount: u64 }
YieldWithdrawn<phantom T>: { object_id: ID, protocol: String, amount: u64 }
VaultYieldInvested:        { vault_id: ID, token: String, protocol: String, amount: u64 }
VaultYieldWithdrawn:       { vault_id: ID, token: String, protocol: String, amount: u64 }
```

> Protocol-specific implementation details will be added to this doc once `docs/protocols/*` are written.
