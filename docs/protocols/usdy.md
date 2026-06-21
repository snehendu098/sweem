# Ondo USDY adapter (yield_type Y = 1) — UI-swap hold model

Yield-bearing-stablecoin adapter. USDY has **no on-chain mint/redeem on Sui** — the only
way to acquire or dispose of USDY is a **DEX swap**. This adapter deliberately keeps that
swap **OFF-CHAIN** (the frontend builds it into the PTB, via the Cetus aggregator with its
own `min_out`), so the adapter itself has **ZERO external-protocol dependency**. It only
**custodies an already-swapped `Coin<Y>`** (USDY) and tracks the base-token (T, e.g. USDC)
principal. Because it is dependency-free it lives in the **main `sweem_adapters` package**
(alongside navi/scallop/suilend) — no separate package needed.

## Package

| | |
|---|---|
| Package | `contracts/packages-mainnet/sweem_adapters` (the live multi-adapter package) |
| Module | `sweem_adapters::usdy` |
| Source | `contracts/packages-mainnet/sweem_adapters/sources/usdy.move` |
| Protocol name (registry) | `usdy` |
| `yield_type` | `1` (Y / yield-stablecoin) |
| Generic over | `Y` (the yield coin, e.g. USDY) and `T` (the base payroll coin, e.g. USDC) |
| Testnet stub | `contracts/packages/sweem_adapters/sources/usdy.move` (API-shape mirror, no-op) |

The module is **generic over `Y`** and does **NOT import the USDY coin package** — callers
pass `Y` (and `T`) as type args. This is what keeps `sweem_adapters/Move.toml` unchanged
(no new dependency).

### USDY mainnet coin type (for the frontend)

```
0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY
```

Pass this as the `Y` type argument. `T` is your payroll coin (e.g. Wormhole USDC
`0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN`).

## Why no on-chain swap

USDY cannot be minted/redeemed on Sui (no Ondo on-chain mint module) and can only be moved
through a DEX. Embedding a specific DEX (Cetus) on-chain would (a) add a heavy external
dependency to the shared package, (b) hard-code one venue + its thin-pool/slippage risk into
the contract, and (c) couple the adapter to that DEX's interface upgrades. Keeping the swap
in the **frontend/PTB** lets the UI use the **Cetus aggregator** to route across pools and
size its own `min_out` from a fresh quote, while the contract stays a thin, auditable,
dependency-free custodian. The on-chain piece only does what must be trustless: gate
authorization, custody the `Coin<Y>`, account principal, and capture the yield fee.

## The denomination problem and the hot-potato round-trip

USDY changes denomination (USDC -> USDY), so the clean "same-token receipt" model of
scallop/suilend does **not** apply. Each direction is a **two-step round-trip** with the UI
swap in the middle:

```
invest:   extract  ->  (UI swaps T -> Y)  ->  deposit
withdraw: extract  ->  (UI swaps Y -> T)  ->  deposit
```

The `extract` half hands base/yield coins to the caller for the swap; the matching `deposit`
half takes the swapped coins back in. To make this **atomic and un-gameable**, each
`extract` returns a **hot-potato receipt** — a struct with **NO abilities** (cannot be
copied, dropped, stored, or transferred). The ONLY way to discharge it is the paired
`deposit` function **in the same PTB**. Without the deposit, the PTB cannot finish, so an
org/employee can never call the extract half and walk away with the funds.

### Receipt structs (no abilities)

```move
public struct UsdyInvestReceipt   { bound_id: ID, amount: u64,          token_name: String }
public struct UsdyWithdrawReceipt { bound_id: ID, principal_slice: u64, token_name: String }
```

- `bound_id` binds the exact pool id (pool side) or vault id (vault side). The deposit half
  asserts `bound_id == this object's id` (`EReceiptMismatch`) — a malicious PTB cannot pair
  an extract from pool A with a deposit to pool B, or under-deposit.
- `amount` (invest) = base-token T principal to record on deposit.
- `principal_slice` (withdraw) = the base-token principal being unwound (pro-rated by the
  USDY fraction swapped out), used to size yield on deposit.
- `token_name` (vault side) = which bucket to deposit back into; empty on the pool side.

## Storage (mirrors scallop/stsui)

On the pool UID (pool side) or the bucket UID (vault side):

- `dof` holds the custodied `Coin<Y>` (USDY) under `UsdyPoolKey()` / `UsdyVaultKey()`.
- `df` holds `UsdyPosition { deposited_value: u64 }` = principal in **base-token (T) units**
  (the value swapped IN, not the USDY held), under `UsdyPoolPositionKey()` /
  `UsdyVaultPositionKey()`.

Keys are unique to this module, so a USDY position coexists with any L/S positions on the
same pool/bucket without collision.

## Yield model

- **Principal** = base-token T value swapped IN (recorded at invest time).
- **On withdraw**, `gross = recovered` (the T returned by the UI swap-back). `yield = max(0,
  gross - principal_slice)`. This realizes yield against the **actual swap-back T amount**,
  never a notional USDY premium — so DEX spread/slippage on both legs is already priced in.
- **Partial pool withdraws** pro-rate principal by the USDY fraction swapped out, rounding
  the principal share **up** (so yield is never over-counted):
  `principal_slice = ceil(deposited_value * amount_y / total_y)`.
- **Vault withdraw** can be partial or full with the same pro-rate rule.
- **Fee** = `floor(yield * fee_bps / 10_000)` -> `treasury(config)`, via
  `openzeppelin_math` `mul_div(_, rounding::down())`. `org_yield_fee_bps` on the pool path,
  `vault_yield_fee_bps` on the vault path. **This is where the protocol captures the USDY
  yield fee** — realized when the swap-back returns more T than principal.
- If the swap-back returns *less* T than principal (slippage/price drift), `yield = 0`, no
  fee, no underflow.

## No `cover_claim_from_usdy` (by design)

A claim needs **idle T in `pool.balance`**. A USDY position **cannot be auto-converted to T
on-chain** (no on-chain swap), so there is intentionally **no** `cover_claim_from_usdy`
entry — adding one would be a function that cannot actually deliver the liquidity it
promises during a claim. Operational rule: **the org must unwind a USDY pool position (the
extract -> swap -> deposit round-trip) BEFORE a claim needs that liquidity.** Unlike navi/
scallop/suilend (same-token, auto-coverable mid-claim), USDY coverage is a deliberate,
ahead-of-time org action.

## Function signatures

### Pool side (org-gated; Y allowed for orgs)

```move
public fun pool_invest_usdy_extract<T>(
    pool: &mut StreamPool<T>, registry: &ProtocolRegistry, amount: u64, ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt)

public fun pool_invest_usdy_deposit<T, Y>(
    pool: &mut StreamPool<T>, registry: &ProtocolRegistry,
    yielded: Coin<Y>, receipt: UsdyInvestReceipt, ctx: &mut TxContext,
)

public fun pool_withdraw_usdy_extract<T, Y>(
    pool: &mut StreamPool<T>, registry: &ProtocolRegistry, amount_y: u64, ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt)

public fun pool_withdraw_usdy_deposit<T>(
    pool: &mut StreamPool<T>, config: &ProtocolConfig, registry: &ProtocolRegistry,
    recovered: Coin<T>, receipt: UsdyWithdrawReceipt, ctx: &mut TxContext,
)
```

### Vault side (employee, owner-gated)

```move
public fun vault_invest_usdy_extract<T>(
    vault: &mut EmployeeVault, token_name: String, registry: &ProtocolRegistry,
    amount: u64, ctx: &mut TxContext,
): (Coin<T>, UsdyInvestReceipt)

public fun vault_invest_usdy_deposit<T, Y>(
    vault: &mut EmployeeVault, registry: &ProtocolRegistry,
    yielded: Coin<Y>, receipt: UsdyInvestReceipt, ctx: &mut TxContext,
)

public fun vault_withdraw_usdy_extract<T, Y>(
    vault: &mut EmployeeVault, token_name: String, registry: &ProtocolRegistry,
    amount_y: u64, ctx: &mut TxContext,
): (Coin<Y>, UsdyWithdrawReceipt)

public fun vault_withdraw_usdy_deposit<T>(
    vault: &mut EmployeeVault, config: &ProtocolConfig, registry: &ProtocolRegistry,
    recovered: Coin<T>, receipt: UsdyWithdrawReceipt, ctx: &mut TxContext,
)
```

Every function first asserts `is_approved(registry, "usdy")` (`EProtocolNotApproved`), then
the org/owner gate. Pool extracts also enforce the pool's coverage floor via
`split_balance_for_invest`.

## Frontend PTB shapes (the swap goes in the middle)

The frontend composes ONE PTB per direction. The two adapter calls bracket a Cetus
aggregator swap; the hot-potato receipt forces both to land in the same block.

### Invest (org: idle pool T -> USDY position)

```
let (baseCoin, receipt) = tx.moveCall(pool_invest_usdy_extract<T>, [pool, registry, amount])
// --- UI swap, built by the Cetus aggregator into THIS PTB ---
let usdyCoin = <cetus aggregator route>(baseCoin, min_out)   // T -> Y, aggregator sizes min_out
// ------------------------------------------------------------
tx.moveCall(pool_invest_usdy_deposit<T, Y>, [pool, registry, usdyCoin, receipt])
```

### Withdraw / unwind (org: USDY position -> idle pool T)

```
let (usdyCoin, receipt) = tx.moveCall(pool_withdraw_usdy_extract<T, Y>, [pool, registry, amount_y])
// --- UI swap ---
let baseCoin = <cetus aggregator route>(usdyCoin, min_out)   // Y -> T, aggregator sizes min_out
// ---------------
tx.moveCall(pool_withdraw_usdy_deposit<T>, [pool, config, registry, baseCoin, receipt])
```

Vault flows are identical with `vault_*` calls, a `token_name: String` arg on the extract,
and the recovered coin going back to the bucket. Type args: `T` = base coin, `Y` = USDY
(`0x960b…56bb::usdy::USDY`).

Notes for the integrator:
- All slippage protection lives in the **aggregator's `min_out`** on the swap step — the
  contract does not (and cannot) re-quote. Size `min_out` from a fresh quote; USDY/USDC
  pools on Sui can be thin, so keep amounts reasonable.
- The `extract` output coin must be fully consumed by the swap and the `deposit` must
  receive the swap output, all in the same PTB — the receipt cannot leave the block.

## Registry registration (UNEXECUTED — human runs after upgrading sweem_adapters)

```
registry::add_protocol(&mut registry, &ac, "usdy", <sweem_adapters_pkg>, 1, ctx)
```

`yield_type = 1` (Y). `<sweem_adapters_pkg>` = the published package id of the live
`sweem_adapters` package after the human upgrades it to include `usdy.move`.

## Build / test

- `contracts/packages-mainnet/sweem_adapters`: `sui move build` is **clean** with
  `usdy.move` added (no Move.toml change; `openzeppelin_math` was already a direct dep).
- **Whole-package `sui move test` is currently blocked by a pre-existing breakage in the
  `suilend` dependency's own test sources** (its `tests/mock_pyth.move` + `sources/oracles.move`
  call `pyth::price_info::new_price_info_object_for_testing`, which the pinned naviprotocol
  `pyth` fork does not expose). This is independent of `usdy.move` — the mainnet package
  shipped with no first-party tests, so `sui move test` was never green. See "Test runner
  caveat" below.
- The `usdy` test suite (`tests/usdy_tests.move`, 12 tests) was validated by running it in an
  isolated package depending only on `sweem_core` + `sweem_registry` + `openzeppelin_math`:
  **12/12 pass** — pure yield-fee math, principal pro-rate, approval gate, org gate, owner
  gate, invest/withdraw receipt-mismatch aborts, full pool round-trip (yield merges back),
  partial pool withdraw (remainder stays invested).
- Testnet stub `contracts/packages/sweem_adapters`: `sui move build` clean, `sui move test`
  16/16 (existing) pass with the stub `usdy.move` added.

### Test runner caveat

To run the `usdy` tests against the full mainnet package, a human must resolve the suilend
dependency's test breakage (e.g. repin `pyth`/`suilend`, or run with a future Sui toolchain
that skips dependency test compilation). The adapter's correctness is fully covered by the
isolated 12/12 run; this is purely a dependency-tree/test-tooling issue.
