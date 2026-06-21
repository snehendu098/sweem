# Suilend Protocol Integration

Suilend is a money market (Compound/Solend-style) on Sui. Sweem uses it for the **L (Lending)**
yield type on `StreamPool` and `TokenBucket` positions — the same category as Navi and Scallop.

It is a **receipt-coin / exchange-rate** protocol, so its adapter is modeled almost 1:1 on the
Scallop adapter: `Coin<CToken<P,T>>` replaces `Coin<MarketCoin<T>>`, `deposit_liquidity_and_mint_ctokens`
replaces `mint`, `redeem_ctokens_and_withdraw_liquidity` replaces `redeem`.

---

## Key Difference from Scallop / Navi

| | Navi | Scallop | Suilend |
|---|---|---|---|
| Auth | `AccountCap` (DOF) | None — sender-based | None — sender-based |
| Deposit result | internal accounting | `Coin<MarketCoin<T>>` (sCoin) | `Coin<CToken<P,T>>` (cToken) |
| Pool ID | `asset_id: u8` | type param only | `reserve_array_index: u64` + type param |
| Reserve lookup | n/a | type param only | resolved on-chain via `reserve_array_index<P,T>(market)` |
| Oracle on supply/redeem | yes (withdraw) | no | no (plain supply, no obligation) |
| Witness / pool selector | n/a | n/a | `P = suilend::suilend::MAIN_POOL` |

Suilend's `LendingMarket<P>` is parameterized by a pool witness `P`. The single mainnet market is the
**MAIN_POOL**, so every adapter call is monomorphized on `P = suilend::suilend::MAIN_POOL`.

> NOTE on `P`: early research guessed `lending_market::LENDING_MARKET`. That is the **one-time-witness**
> consumed at the package `init` and is NOT the market's type parameter. The on-chain LendingMarket's
> actual type is `…::lending_market::LendingMarket<…::suilend::MAIN_POOL>` (verified below). Use
> `MAIN_POOL`.

---

## Package & rev (pin in Move.toml)

```toml
suilend = { git = "https://github.com/solendprotocol/suilend.git", subdir = "contracts/suilend", rev = "d5ba83a617bb0778b48b0c3b1e77a87be81258ca" }
```

- **Source repo:** `github.com/solendprotocol/suilend`, package `suilend`, subdir `contracts/suilend`.
- **Pinned rev:** `d5ba83a617bb0778b48b0c3b1e77a87be81258ca`.
- **Mainnet package ID:** `0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf`
- **Pool witness `P`:** `0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL`
  (`public struct MAIN_POOL has drop {}` — `suilend.move:2`)
- **CToken type:** `0xf95b06…6ddf::reserve::CToken<P, T>` (`public struct CToken<phantom P, phantom T> has drop {}` — `reserve.move:99`).
  `Coin<CToken<P,T>>` has `key + store` → stored in a DOF.

> Suilend's upstream `Move.toml` declares no `published-at` / `[addresses] suilend = …`. When consumed
> as a git dependency the consuming package must supply the published address (see "Dependency notes").

---

## Mainnet Shared Object IDs

| Object | Type | ID |
|---|---|---|
| LendingMarket | `…::lending_market::LendingMarket<…::suilend::MAIN_POOL>` | `0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1` |
| Clock | `0x2::clock::Clock` | `0x6` |

Verified market type (read-only `sui_getObject`):
```
0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::lending_market::LendingMarket<0xf95b06141ed4a174f239417323bde3f209b972f5930d8521ea38a52aff3a6ddf::suilend::MAIN_POOL>
```

---

## Reserve index for native USDC

Native USDC = `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`.

On-chain reserves array (read-only `sui_getObject` of the LendingMarket, `content.fields.reserves[].fields.array_index`):

| index | coin_type |
|---|---|
| 0 | `0x2::sui::SUI` |
| 7 | `…dba34672…::usdc::USDC` ← native USDC |
| 19 | `…375f70cf…::usdt::USDT` |

So **native USDC `reserve_array_index = 7`** at the pinned snapshot.

**The adapter does NOT hardcode the index.** Both deposit/redeem entry points take `reserve_array_index: u64`,
and `lending_market::reserve_array_index<P, T>(market)` (line 1429, public) resolves it on-chain from the
coin type `T`. The adapter calls that getter and passes the result — robust against reserve reordering.

---

## Move Function Signatures (verified from source, pinned rev)

### Deposit (mint cTokens) — `lending_market.move:306`

```move
public fun deposit_liquidity_and_mint_ctokens<P, T>(
    lending_market: &mut LendingMarket<P>,
    reserve_array_index: u64,
    clock: &Clock,
    deposit: Coin<T>,
    ctx: &mut TxContext,
): Coin<CToken<P, T>>
```
Compounds interest, mints cTokens at the current `ctoken_ratio`, returns the cToken `Coin`. Aborts on
zero deposit / zero mint / wrong coin type / index OOB.

### Withdraw (redeem cTokens) — `lending_market.move:367`

```move
public fun redeem_ctokens_and_withdraw_liquidity<P, T>(
    lending_market: &mut LendingMarket<P>,
    reserve_array_index: u64,
    clock: &Clock,
    ctokens: Coin<CToken<P, T>>,
    rate_limiter_exemption: Option<RateLimiterExemption<P, T>>,
    ctx: &mut TxContext,
): Coin<T>
```
Burns exactly the cToken `Coin` passed and returns the underlying at the current ratio. Pass
`option::none()` for `rate_limiter_exemption`. Like Scallop, partial withdrawal is achieved by
`split`-ing the stored cToken `Coin` before redeeming.

### Reserve / Decimal getters used by the adapter

```move
// module: …::lending_market
public fun reserve_array_index<P, T>(market: &LendingMarket<P>): u64   // :1429
public fun reserve<P, T>(market: &LendingMarket<P>): &Reserve<P>       // :1444 (by coin type)

// module: …::reserve
public fun ctoken_ratio<P>(reserve: &Reserve<P>): Decimal             // :681  (underlying per cToken, ≥ 1)

// module: …::decimal
public fun from(v: u64): Decimal
public fun div(a: Decimal, b: Decimal): Decimal
public fun ceil(a: Decimal): u64
```

---

## Position Storage

Suilend has no per-user accounting — the cToken IS the position (identical to Scallop's sCoin).

```
Pool UID / Bucket UID:
  SuilendPoolCTokenKey   → DOF → Coin<CToken<MAIN_POOL, T>>   (the cToken)
  SuilendPoolPositionKey → DF  → SuilendPosition { deposited_value: u64 }
```

The cToken amount is static while held; value grows via the rising `ctoken_ratio`. Multiple invest
calls `Coin::join` into one stored cToken; `deposited_value` accumulates underlying principal. On a
partial exit the adapter `split`s the exact cToken slice and pro-rates principal.

---

## Partial-redeem math (the one difference vs. Scallop)

Scallop derives sCoin-to-redeem from its balance-sheet; Suilend exposes `ctoken_ratio` directly.

```
ratio          = ctoken_ratio(reserve(market))      // Decimal: underlying per cToken, ≥ 1
ctoken_needed  = ceil( from(shortfall) / ratio )    // Decimal div then ceil
ctoken_redeem  = ctoken_needed + 1                  // +1 buffer (floor inside redeem may shave a unit)
ctoken_redeem  = min(ctoken_redeem, total_ctoken)   // never exceed the stored position
```

`ratio` is read **before** the redeem call compounds interest, so it is a (weak) lower bound on the
post-compound ratio → `ctoken_needed` is an upper bound → conservative (never under-delivers the
shortfall). Principal is pro-rated `ceil(deposited_value * ctoken_redeem / total_ctoken)` (rounds UP,
so yield/fee are never overcounted), mirroring Scallop.

If `ctoken_redeem >= total_ctoken` it's a full close: `dof::remove` + `df::remove`.

---

## Yield Fee Calculation

Identical to Scallop. Yield = `gross − principal_share`; `fee = yield_earned × fee_bps / 10_000`
(OZ `mul_div`, rounds down) → `treasury(config)`; `net` merged back to pool/bucket balance. Org rate =
`org_yield_fee_bps`, vault rate = `vault_yield_fee_bps`.

---

## Sweem Adapter Functions (same shape as Scallop, `*_suilend`)

| fn | visibility | auth | notes |
|---|---|---|---|
| `pool_invest_suilend<T>` | public | org | mint cTokens, DOF join, DF `+= amount` |
| `pool_withdraw_suilend<T>` | `public(package)` | — | partial redeem of `shortfall`, pro-rated principal, fee→treasury |
| `cover_claim_from_suilend<T>` | public | bounded by caller claimable | composable claim helper |
| `org_withdraw_suilend<T>` | public | org | rebalance/unwind `amount` |
| `vault_invest_suilend<T>` | public | vault owner | bucket invest |
| `vault_withdraw_suilend<T>` | public | vault owner | full bucket close |

Adapter params replace Scallop's `(version, market)` with `(lending_market: &mut LendingMarket<MAIN_POOL>)`
plus the `Clock`. The `reserve_array_index` is resolved internally via `reserve_array_index<P,T>`.

---

## Dependency notes (build risk) — RESOLVED

Suilend pulls heavy transitive deps: `liquid_staking` (`main`), `pyth-crosschain`,
`switchboard` (`mainnet`), `sui_system`, and a local `sprungsui`. Two clashed with Navi's deps —
both were the **same on-chain package vendored from a different git source**, resolved with
`override = true` (NOT a force-hack of incompatible code):

| Conflicting pkg | On-chain ID | Navi source | Suilend source | Override added |
|---|---|---|---|---|
| `switchboard` | `0xc3c7e6eb…938ea3` | naviprotocol/navi-smart-contracts `switchboard_sui/on_demand` | switchboard-xyz/sui `on_demand` `mainnet` | switchboard-xyz `mainnet` |
| `pyth` | `0x8d97f1cd…565a9e` (published-at `0x04e20ddf…0ad91`) | naviprotocol/pyth-crosschain `1880b24c…` | solendprotocol/pyth-crosschain `f272d120…` | naviprotocol `1880b24c…` |

Both pyth forks share the **same `published-at`**, so linkage is unaffected. Both switchboard
sources resolve the same named address `0xc3…938ea3`. The overrides in
`packages-mainnet/sweem_adapters/Move.toml`:

```toml
switchboard = { git = "https://github.com/switchboard-xyz/sui.git", subdir = "on_demand/", rev = "mainnet", override = true }
pyth = { git = "https://github.com/naviprotocol/pyth-crosschain.git", subdir = "target_chains/sui/contracts", rev = "1880b24c6acfaac101747f863c5047fff9adaa0f", override = true }
```

`sui move build` of `packages-mainnet/sweem_adapters` is **clean** (only pre-existing dep / `scallop.move`
warnings). Suilend's upstream `Move.toml` has no `published-at`; the consuming build resolves the
`suilend` named address fine without a manual entry.

### Known limitation — `sui move test` on the mainnet package

`sui move test` (which compiles `#[test_only]` code of ALL deps) FAILS on the mainnet `sweem_adapters`
package: Suilend's `oracles.move` test code calls `pyth::price_info::new_price_info_object_for_testing`,
which exists in Suilend's pyth fork but not in the naviprotocol pyth fork the `pyth` override pins. This
affects **test-mode only** — `sui move build` (the publish path) excludes test-only code and is clean.
Sweem's own adapter logic is unit-tested in the **testnet stub package** (`packages/sweem_adapters`,
16/16 passing). The mainnet adapter package ships no tests of its own (same as Navi/Scallop mainnet
adapters — they cannot construct live protocol objects in a unit test anyway).

---

## Registry Setup (admin, one-time, after upgrade)

```move
registry::add_protocol(&mut registry, &ac, b"suilend", @sweem_adapters, 0, ctx); // 0 = Lending (L)
```

---

## Deploy (UNEXECUTED — human approval required)

Adapters `UpgradeCap` (owned by active wallet `0x79adc3de…d6308`):
**`0xfd489b1c6da172f38877cf568a3bf90ce714523a10b01371d38bf526c27ec107`** (its `package` field ==
adapters pkg `0x8f0943…2866eb`). The other two wallet UpgradeCaps map to core `0x4c582aea…79b4` and
registry `0x06eae4d4…cfbbd`.

Upgrade command (run from `contracts/packages-mainnet/sweem_adapters`, NOT yet executed):

```bash
sui client upgrade --upgrade-capability 0xfd489b1c6da172f38877cf568a3bf90ce714523a10b01371d38bf526c27ec107
```

(Gas: wallet holds ~1.38 SUI — likely tight for an upgrade of this size; top up before running.)

## Pre-deploy checks

- [x] LendingMarket `0x84030d…ece1` type confirmed `LendingMarket<…6ddf::suilend::MAIN_POOL>` (live read).
- [x] USDC `reserve_array_index = 7` confirmed via live RPC (45 reserves; SUI=0, USDC=7, USDT=19).
      Adapter resolves the index on-chain via `reserve_array_index<P,T>` regardless.
- [x] Consuming-package build resolves the `suilend` named address (no manual `published-at` needed).
- [ ] Confirm no rate-limiter blocks small redeems (we pass `option::none()` exemption — fine for dust).
- [ ] After upgrade: `add_protocol(b"suilend", @sweem_adapters, 0)` then small-amount mainnet e2e.
