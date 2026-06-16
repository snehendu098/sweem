# sweem_adapters

`contracts/packages-mainnet/sweem_adapters/sources/`

Two yield protocol adapters are implemented. Two environments exist:

| Environment | Path | Protocol calls |
|---|---|---|
| Testnet | `contracts/packages/sweem_adapters/` | Stubs — emit events, track position in DF, no real fund movement |
| Mainnet | `contracts/packages-mainnet/sweem_adapters/` | Real Navi + Scallop calls |

---

## Modules

| Module | Purpose |
|---|---|
| `navi` | Navi lending adapter (pool + vault invest/withdraw) |
| `claim_liquidity` | Employee claim entry point for Navi pools |
| `scallop` | Scallop lending adapter (pool + vault invest/withdraw) |
| `claim_liquidity_scallop` | Employee claim entry point for Scallop pools |

---

## Navi (Mainnet)

### Dependencies

```toml
lending_core = { git = "https://github.com/naviprotocol/navi-smart-contracts.git", subdir = "lending_core", rev = "main" }
oracle       = { git = "https://github.com/naviprotocol/navi-smart-contracts.git", subdir = "oracle",       rev = "main" }
```

`oracle` is a direct dependency even though `lending_core` also imports it — without the direct dep the compiler can't resolve the `oracle` package address.

### AccountCap pattern

Navi tracks positions per `AccountCap` object, not per `ctx.sender()`. One `AccountCap` is stored per `StreamPool` and per vault bucket as a DOF.

```
store_pool_account_cap<T>(pool, cap, ctx)    // org registers once at setup
store_vault_account_cap(vault, cap, ctx)     // employee registers once at setup
```

The cap is stored as DOF keyed by `NaviPoolCapKey` / `NaviVaultCapKey`. It never leaves the pool/vault — adapters borrow it mutably to call Navi.

### Position storage

```
Pool UID:
  NaviPoolCapKey    → DOF → AccountCap
  NaviPoolPositionKey → DF → NaviPosition { deposited_value: u64 }

Bucket UID:
  NaviVaultCapKey     → DOF → AccountCap
  NaviVaultPositionKey → DF → NaviPosition { deposited_value: u64 }
```

`deposited_value` tracks total principal deposited. Used to compute the proportional principal share and isolate yield at withdrawal time.

### Pool yield flow

```move
// Org moves idle balance into Navi
pool_invest_navi<T>(pool, storage, navi_pool, incentive_v2, incentive_v3, registry, clock, asset_id, amount, ctx)

// Called internally by claim_liquidity when pool cash < claimable
pool_withdraw_navi<T>(pool, storage, navi_pool, incentive_v2, incentive_v3, oracle, config, clock, registry, asset_id, amount, ctx)
```

`pool_withdraw_navi` supports partial withdrawal — it withdraws exactly `amount`, computes proportional yield on that portion, and updates `NaviPosition.deposited_value` accordingly.

Yield fee formula:
```
principal_share = deposited_value * amount / gross    (OZ u128 mul_div, rounds down)
yield_earned    = max(0, gross - principal_share)
fee             = yield_earned * org_yield_fee_bps / 10_000
```

### Vault yield flow

```move
vault_invest_navi<T>(vault, token_name, storage, navi_pool, incentive_v2, incentive_v3, registry, clock, asset_id, amount, ctx)
vault_withdraw_navi<T>(vault, token_name, storage, navi_pool, incentive_v2, incentive_v3, oracle, config, clock, registry, asset_id, amount, ctx)
```

Same arithmetic, uses `vault_yield_fee_bps` instead of `org_yield_fee_bps`.

### Borrow checker pattern

Move's borrow checker prevents holding a `&mut` ref while passing the same object elsewhere. The adapter resolves this with block expressions to limit reference lifetimes:

```move
let gross_bal: Balance<T> = {
    let cap: &mut AccountCap = dof::borrow_mut(bucket_uid_mut(bucket), NaviVaultCapKey());
    withdraw_with_account_cap<T>(..., cap)
};
// cap block ended — bucket is free, safe to merge
merge_bucket_from_yield(bucket, gross_bal);
```

### claim_liquidity module

```move
// sweem_adapters::claim_liquidity
public fun claim_with_liquidity<T>(
    pool, storage, navi_pool, incentive_v2, incentive_v3, oracle, registry, config, clock, asset_id, ctx
): Coin<T>
```

1. Compute `claimable = stream_pool::claimable_amount(pool, sender, clock)`
2. If `pool.balance < claimable`: call `pool_withdraw_navi` for the exact shortfall
3. Assert `pool.balance >= claimable` — aborts `EInsufficientPoolLiquidity` if still short
4. Call `stream_pool::claim` → returns `Coin<T>`

Partial withdrawal means only the minimum needed is pulled from Navi — idle funds keep earning yield.

---

## Scallop (Mainnet)

### Dependencies

```toml
protocol = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "contracts/protocol", rev = "main" }
```

The MVR name `lending@scallop/core` maps to this package but has no git URL registered in MVR. Use the git URL directly.

**Protocol named address:** `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`

### No AccountCap required

Scallop is sender-based — no setup step needed before investing. The adapter calls `protocol::mint::mint` and `protocol::redeem::redeem` directly.

### Receipt token (sCoin)

`mint<T>` returns `Coin<MarketCoin<T>>` (sCoin). This IS the position — Scallop has no internal per-user accounting.

**The sCoin amount is fixed after mint.** Yield accrues as a rising exchange rate, not as additional sCoin. You deposit 100 USDC, receive N sUSDC, hold N sUSDC forever, and redeem N sUSDC later for 105 USDC. The N never changes — only what N is worth changes. This is the same model as Compound's cTokens.

Sweem stores the sCoin as a DOF on the pool/vault UID and never touches it between invest and redeem:

```
Pool UID:
  ScallopPoolMarketCoinKey → DOF → Coin<MarketCoin<T>>   (static amount, rising value)
  ScallopPoolPositionKey   → DF  → ScallopPosition { deposited_value: u64 }  (original USDC in)

Bucket UID:
  ScallopVaultMarketCoinKey → DOF → Coin<MarketCoin<T>>
  ScallopVaultPositionKey   → DF  → ScallopPosition { deposited_value: u64 }
```

Multiple invest calls join into the single stored sCoin via `Coin::join`. `deposited_value` accumulates the original T deposited across all calls — used at redemption to compute `yield = gross - deposited_value`.

### Pool yield flow

```move
// Org deposits into Scallop
pool_invest_scallop<T>(pool, version, market, registry, clock, amount, ctx)

// Called internally by claim_liquidity_scallop when pool cash < claimable
pool_withdraw_scallop<T>(pool, version, market, config, registry, clock, ctx)    // public(package)
```

`pool_withdraw_scallop(shortfall)` performs **partial** redemption: the adapter reads the Market exchange rate, computes `scoin_to_redeem = ceil(shortfall * supply / backing) + 1` (capped at the full position), `split`s exactly that much sCoin, and redeems only it — the remainder stays invested. Scallop's `redeem` primitive itself takes whatever sCoin coin you hand it; partial is achieved by splitting before redeeming. Only when the needed sCoin meets or exceeds the whole position does it close out entirely.

Yield fee formula — full close uses the whole baseline; a partial close pro-rates the principal (rounding up so yield/fee is never overcounted):
```
// partial:
principal_share = ceil(deposited_value * scoin_to_redeem / total_scoin)
// full:
principal_share = deposited_value

yield_earned    = max(0, gross - principal_share)
fee             = yield_earned * org_yield_fee_bps / 10_000
```

### Vault yield flow

```move
vault_invest_scallop<T>(vault, token_name, version, market, registry, clock, amount, ctx)
vault_withdraw_scallop<T>(vault, token_name, version, market, config, registry, clock, ctx)
```

Same pattern — full redemption, `vault_yield_fee_bps` applied.

### claim_liquidity_scallop module

```move
// sweem_adapters::claim_liquidity_scallop
public fun claim_with_liquidity_scallop<T>(
    pool, version, market, registry, config, clock, ctx
): Coin<T>
```

Same structure as `claim_with_liquidity` but calls `pool_withdraw_scallop` on shortfall. Cleaner signature — no `asset_id`, no oracle, no incentive objects.

---

## Multi-Protocol Pools (split across L / Y / S)

A pool or vault bucket can hold positions in several protocols at once — each adapter stores its position under its own DF/DOF key types, so they never collide. Three claim/rebalance paths exist depending on how the pool is invested.

### Single-protocol pool — dedicated entry

If a pool uses only Navi, use `claim_with_liquidity`. Only Scallop → `claim_with_liquidity_scallop`. One call, smallest object set.

### Split pool — composable cover primitives

When a pool is split across multiple protocols, the claim is **composed in a PTB**, not handled by one mega-function (Move can't take heterogeneous protocol objects generically). Each adapter exposes:

```move
// Pulls up to max_amount of the CALLER'S OWN claim shortfall out of the protocol
// into pool.balance. Does NOT claim. Bounded by claimable → safe to be public.
public fun cover_claim_from_navi<T>(pool, <navi objs>, registry, config, clock, asset_id, max_amount, ctx)
public fun cover_claim_from_scallop<T>(pool, <scallop objs>, registry, config, clock, max_amount, ctx)
```

Employee claim PTB for a Navi+Scallop pool:

```
cover_claim_from_navi(...,    max_amount = navi_share)      // top up idle cash from Navi
cover_claim_from_scallop(..., max_amount = claimable)       // cover the rest from Scallop
stream_pool::claim(...)                                     // pays out; asserts sufficiency
```

Each `cover_*` recomputes the remaining shortfall (`claimable - balance`), so chaining composes naturally and any single call is a no-op if cash already covers. The terminal `stream_pool::claim` is the single point that asserts the pool can pay — if the chain falls short it aborts there with `EInsufficientBalance`, atomically (nothing changes).

**Why `public` is safe here:** the draw is bounded by `claimable_amount(pool, ctx.sender())`. A non-employee gets `claimable = 0` → no-op; an employee can only ever unwind toward what they are already owed. There is no way to force-unwind the org's position for grief — the bound is the gate. `pool_withdraw_*` itself stays `public(package)`.

**Frontend note:** for Navi, pass `max_amount` ≤ the pool's current Navi position (`pool_withdraw_navi` withdraws exactly the requested amount). Scallop self-caps redemption to its full position, so its `max_amount` can be the full shortfall. Only include a `cover_*` call for protocols the pool actually holds a position in.

### Org rebalancing

```move
public fun org_withdraw_navi<T>(pool, <navi objs>, ..., amount, ctx)      // org-gated
public fun org_withdraw_scallop<T>(pool, <scallop objs>, ..., amount, ctx) // org-gated
```

Org-gated unwind back to idle cash. Rebalance is one PTB: `org_withdraw_navi(x)` → `pool_invest_scallop(x)`. Distinct from the in-claim `pool_withdraw_*` (which runs on behalf of the employee, so it can't be org-gated). `withdraw_excess` still only returns *uninvested* cash above the coverage floor; `org_withdraw_*` is what unwinds an actual yield position.

---

## Navi vs Scallop — Key Differences

| | Navi | Scallop |
|---|---|---|
| Setup | `store_pool_account_cap` + `store_vault_account_cap` (one-time) | None |
| Shared objects required | `Storage, Pool<T>, IncentiveV2, IncentiveV3, PriceOracle` | `Version, Market` |
| Pool withdrawal granularity | Partial — exact `amount` requested | Partial — adapter splits sCoin for the `shortfall` |
| Pool position after partial claim | Reduced proportionally | Reduced; remainder stays invested (zeroed only on full redeem) |
| Vault withdrawal granularity | Partial (`amount`) | Full position (no `amount` arg) |
| Oracle required | Yes (on withdraw) | No |
| Pool ID | `asset_id: u8` | Type param only |

---

## Testnet Stubs

`contracts/packages/sweem_adapters/` — identical public API, no external deps.

Both `navi` and `scallop` modules exist in the stub package with simplified signatures (no protocol objects, no fund movement). They track a `NaviPosition` / `ScallopPosition` DF and emit events. This lets you run the full Sweem flow on testnet without needing live Navi or Scallop objects.

| Stub module | What it does |
|---|---|
| `navi` | DF tracking + events, simplified 4-param signatures |
| `claim_liquidity` | Calls `stream_pool::claim` directly |
| `scallop` | DF tracking + events, simplified 4-param signatures |
| `claim_liquidity_scallop` | Calls `stream_pool::claim` directly |

---

## Registry Setup (admin, post-deploy)

Both protocols must be registered before their adapter functions will execute:

```move
registry::add_protocol(&mut registry, &ac, b"navi",    @sweem_adapters, 0, ctx);
registry::add_protocol(&mut registry, &ac, b"scallop", @sweem_adapters, 0, ctx);
// yield_type 0 = Lending (L)
```
