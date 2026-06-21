# AlphaFi AlphaLend adapter (yield_type L = 0)

Lending yield adapter. Supplies a coin (e.g. USDC) as collateral into AlphaFi's
AlphaLend market and withdraws it back. **Full adapter API** (pool + vault +
employee-claim + org-rebalance) and lives in its **own package** — see rationale
below.

## Package

| | |
|---|---|
| New package | `contracts/packages-mainnet/sweem_adapters_alphalend` |
| Module | `sweem_adapters_alphalend::alphalend` |
| Protocol name (registry) | `alphalend` |
| `yield_type` | `0` (L / lending) |
| Supplied coin `C` | any market coin (USDC, USDT, …); generic `<T>` |

## On-chain ids (mainnet) — all verified read-only via `sui client object` / RPC

| Object / type | Id |
|---|---|
| `alpha_lending` package — original / first publish (type origin) | `0xd631cd66138909636fc3f73ed75820d0c5b76332d1644608ed1c85ea2b8219b4` |
| `alpha_lending` package — **latest, what you call** | `0xee754fc0c6d977403c9218cedbfffed033b4b42b50a65c2c3f1c7be13efeafd2` |
| `LendingProtocol` shared object | `0x01d9cf05d65fa3a9bb7163095139120e3c4e414dfbab153a49779a7d14010b93` |
| AlphaFi oracle package (latest) | `0x39850d8deb783ef11b10487dc8a80a701506b1471ce11cde83124f35ba3da699` |
| AlphaFi `oracle::Oracle` shared object | `0xce4ca140eb264bdc5b03f3268eeb013495f04561e38473aadcf654fb0db6b096` |
| `alphafi_stdlib` package | `0x4b591bbc246c9fadd28e7ac895e0778fb0e102f1b0d9f441e78d35f0d1ea1fcc` |
| Clock | `0x6` |

`LendingProtocol` verified on mainnet (read-only):
- `objType = 0xd631cd66…219b4::alpha_lending::LendingProtocol`
- owner = `Shared` (initial_shared_version 542900438)
- holds a `markets` Table (35 markets) and an embedded `oracle` (the price the
  withdraw path reads).

### Market ids (verified by reading each market's `coin_type` from the markets Table)

| market_id | coin |
|---|---|
| 1 | `0x2::sui::SUI` |
| 2 | `…::stsui::STSUI` |
| 3 | `…::btc::BTC` |
| 4 | `…::lbtc::LBTC` |
| 5 | `0x375f70cf…::usdt::USDT` |
| **6** | **`0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`** |
| 7 | `…::wal::WAL` |
| 8 | `…::deep::DEEP` |

USDC = **market_id 6**, SUI = **market_id 1**. (35 markets total; full set readable
from the markets Table `0x2326d387ba8bb7d24aa4cfa31f9a1e58bf9234b097574afb06c5dfb267df4c2e`.)

### Pyth price feed / PriceInfoObject for the refresh (from upstream README)

| coin | Pyth price-info object (mainnet) |
|---|---|
| USDC | `0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab` |
| SUI | `0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37` |
| USDT | `0x985e3db9f93f76ee8bace7c3dd5cc676a096accd5d9e09e9ae0fb6e492b14572` |

(Stale price objects must be refreshed from Pyth first; see Price refresh below.)

## AlphaLend dependency (vendored + pinned)

Source repo `https://github.com/AlphaFiTech/alphalend-contracts-interfaces.git`,
commit **`4b3c8350f5824261136be27e5894b57a5619f691`**.

The `alpha_lending` interface package is **vendored** under
`sweem_adapters_alphalend/vendor/` (alpha_lending + alphafi_oracle + alphafi_stdlib).
Reason: the upstream `alpha_lending/Move.toml` references the `sui_system` named
address in `alpha_lending.move` (`fulfill_promise_SUI`) but never declares a
`SuiSystem` dependency, so it does **not compile as-is** (`error[E03001]: address
'sui_system' is not assigned a value`). The vendored copy is byte-for-byte upstream
sources; only `vendor/alpha_lending/Move.toml` was patched to add:

```toml
SuiSystem = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-system", rev = "664b05b3b047c5bb03979d093660176176ea6175", override = true }
```

(The `system = "sui_system"` shorthand fails to parse inside this legacy-edition
manifest — `error parsing '[dependencies]' section` — so the explicit git form,
pinned to the same framework rev the rest of the AlphaLend tree resolves, is used.)

Transitive deps pulled (and successfully resolved): BluefinSpot, CetusClmm,
IntegerLibrary, IntegerMate, MoveSTL, Pyth, Wormhole, SuiSystem. These come in only
because `alpha_lending` declares them; the Sweem adapter itself only touches
`alpha_lending::{alpha_lending, position, market}` types.

## Verified signatures (on-chain bytecode of pkg `0xee754fc0…`, RPC `getNormalizedMoveFunction`)

```move
// create a Position; returns its cap (key+store, transferable/storable)
public fun create_position(
    protocol: &mut LendingProtocol,
    ctx: &mut TxContext,
): PositionCap

// supply collateral. Consumes the whole Coin<C>; returns nothing.
public fun add_collateral<C>(
    protocol: &mut LendingProtocol,
    position_cap: &PositionCap,
    market_id: u64,
    coin: Coin<C>,
    clock: &Clock,
    ctx: &mut TxContext,
)

// withdraw collateral. Returns a HOT-POTATO LiquidityPromise<C> (no ctx arg).
public fun remove_collateral<C>(
    protocol: &mut LendingProtocol,
    position_cap: &PositionCap,
    market_id: u64,
    amount: u64,
    clock: &Clock,
): LiquidityPromise<C>

// fulfill the promise -> Coin<C> (non-SUI assets).
public fun fulfill_promise<C>(
    protocol: &mut LendingProtocol,
    promise: LiquidityPromise<C>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<C>

// SUI-only fulfill variant (takes SuiSystemState). NOT used by this generic adapter.
public fun fulfill_promise_SUI(
    protocol: &mut LendingProtocol,
    promise: LiquidityPromise<SUI>,
    system_state: &mut SuiSystemState,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI>

// push a refreshed price into the LendingProtocol's embedded oracle.
public fun update_price(
    protocol: &mut LendingProtocol,
    price: &alphafi_oracle::oracle::PriceInfo,
)
```

AlphaFi oracle package `0x39850d8d…` (verified):

```move
public fun update_price_from_pyth(
    self: &mut oracle::Oracle,
    price_info_object: &pyth::price_info::PriceInfoObject,
    clock: &Clock,
)
public fun get_price_info(self: &oracle::Oracle, coin_type: TypeName): oracle::PriceInfo
```

`market::LiquidityPromise<phantom C>` has **no abilities** (true hot potato): it must
be consumed by `fulfill_promise`/`fulfill_promise_SUI` in the same PTB or the tx
aborts. The adapter creates and fulfills it inside each withdraw fn — it never escapes.

## Price refresh — REQUIRED before every withdraw (shapes the e2e PTB)

`remove_collateral` reads the oracle **embedded in `LendingProtocol`** and aborts on
a stale price (the README confirms: "remove_collateral, borrow and liquidate
functions require the latest prices… Not updating the price results in transaction
aborted due to assert"). For each withdrawn coin `C`, the PTB must prepend:

```
1. <oracle_pkg>::oracle::update_price_from_pyth(AlphaFiOracle, PriceInfoObject<C>, Clock)
2. ti = 0x1::type_name::get<C>()
3. pi = <oracle_pkg>::oracle::get_price_info(AlphaFiOracle, ti)
4. <alphalend_pkg>::alpha_lending::update_price(LendingProtocol, pi)
   -> then the adapter's withdraw / cover_claim / org_withdraw call
```

Because the refresh lands inside `LendingProtocol`, the **adapter's withdraw fns take
NO oracle argument** (unlike Navi, whose `withdraw_with_account_cap` takes `&PriceOracle`
directly). The refresh is the caller's responsibility in the PTB. Invest
(`add_collateral`) does **not** require a fresh price.

## Adapter API (full — pool + vault)

```move
// one-time setup: mint a Position via create_position and store its cap
public fun store_pool_position_cap<T>(pool, protocol, ctx)        // org-gated
public fun store_vault_position_cap(vault, protocol, ctx)         // owner-gated

// pool side (org payroll funds — allowed because AlphaLend is L)
public fun pool_invest_alphalend<T>(pool, protocol, registry, clock, market_id, amount, ctx)        // org-gated
public(package) fun pool_withdraw_alphalend<T>(pool, protocol, config, clock, registry, market_id, amount, ctx)

// vault side (employee claimed funds)
public fun vault_invest_alphalend<T>(vault, token_name, protocol, registry, clock, market_id, amount, ctx)     // owner-gated
public fun vault_withdraw_alphalend<T>(vault, token_name, protocol, config, clock, registry, market_id, amount, ctx)

// external PTB entry points
public fun cover_claim_from_alphalend<T>(pool, protocol, config, clock, registry, market_id, max_amount, ctx)  // bounded by caller claimable
public fun org_withdraw_alphalend<T>(pool, protocol, config, clock, registry, market_id, amount, ctx)          // org-gated
```

- Every entry gates on `is_approved(registry, "alphalend")` first, then org/owner.
- `cover_claim_from_alphalend` is safe to be public: the draw is bounded by the
  caller's own claim shortfall, so non-employees / over-draws are no-ops.
- One `PositionCap` per pool / per vault-bucket: a single AlphaLend Position can hold
  collateral across many markets, so one cap suffices regardless of coin type.

### Storage

- `PositionCap` (key+store) → DOF under `Alphalend{Pool,Vault}CapKey()`.
- `AlphalendPosition { deposited_value: u64 }` (store-only, the principal) → DF under
  `Alphalend{Pool,Vault}PositionKey()`.

Keys are unique to this module, so an AlphaLend position coexists with any other
adapter's position on the same pool/bucket without collision.

## Yield model — interest-bearing XToken (aToken-style)

AlphaLend uses an XToken share model: supplied collateral grows in underlying terms
as supply interest accrues (the position's withdrawable balance increases). On a
withdrawal of `amount`, `gross ≈ amount` (you receive what you ask for), and realized
yield surfaces as `gross − principal_share`, identical accounting to the Navi adapter:

```
principal_share = min(amount, deposited_value)
yield_earned    = max(gross - principal_share, 0)
fee             = floor(yield_earned * yield_fee_bps / 10_000)   // -> treasury(config)
net             = gross - fee                                     // -> pool / bucket
deposited_value -= principal_share
```

`org_yield_fee_bps` for the pool path, `vault_yield_fee_bps` for the vault path. As
with Navi, yield is collected primarily on full exit (partial exits show ~0 surplus).
Fee math is the pure, unit-tested `compute_yield_fee`.

## Two structural decisions (rationale)

### 1. Full adapter API (not vault-only)

AlphaLend is a lending market (L), so org/pool payroll funds MAY use it — unlike the
stSUI (S) adapter which is deliberately vault-only. Hence all six functions are
present, exactly mirroring `sweem_adapters::navi`.

### 2. Separate package

AlphaLend's dependency tree (Cetus / Bluefin / Pyth / Wormhole / Bridge, plus an
older pinned Sui-framework rev `664b05b3…`) clashes with the framework rev that
`sweem_adapters` already resolves through Navi/Scallop. Isolating this adapter in its
own package — depending only on AlphaLend, not on Suilend/Navi/Scallop — avoids the
clash. The adapter pattern permits it: `registry::is_approved` only checks the
protocol NAME; the registered `adapter_package` address can be any package (stored for
off-chain reference, not enforced on-chain).

## Build / test

```
cd contracts/packages-mainnet/sweem_adapters_alphalend
sui move build   # clean (no warnings)
sui move test    # 8 passing: fee math (4), approval gate, org gate, owner gate, name
```

Unit tests cannot exercise the live `create_position` / `add_collateral` /
`remove_collateral` calls (the shared `LendingProtocol` cannot be constructed in a
unit test), so coverage is: pure yield-fee math, the registry approval gate, and the
org-only and owner-only gates. Full invest→withdraw is validated by the mainnet e2e
(real USDC), not a unit test.

## Testnet stub

Skipped on purpose — validated directly on mainnet with small real USDC.
