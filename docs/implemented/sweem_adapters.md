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

`pool_withdraw_scallop` redeems the **entire** sCoin position in one call — partial redemption is not supported by Scallop's `redeem` interface. After the call, the pool has no Scallop position. The org re-invests on the next deposit/topup cycle.

Yield fee formula (full-position close):
```
yield_earned = max(0, gross - deposited_value)
fee          = yield_earned * org_yield_fee_bps / 10_000
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

## Navi vs Scallop — Key Differences

| | Navi | Scallop |
|---|---|---|
| Setup | `store_pool_account_cap` + `store_vault_account_cap` (one-time) | None |
| Shared objects required | `Storage, Pool<T>, IncentiveV2, IncentiveV3, PriceOracle` | `Version, Market` |
| Withdrawal granularity | Partial — exact `amount` requested | Full position always |
| Position after claim | Reduced proportionally | Zeroed — re-invest manually |
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
