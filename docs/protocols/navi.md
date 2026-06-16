# Navi Protocol Integration

Navi is the primary lending protocol on Sui. Sweem uses it for the **L (Lending)** yield type on StreamPool and TokenBucket positions.

Reference transactions (mainnet):
- Deposit: `EXL4E8H1qXbfFZfPjZA56QAsjuTfVcn7wBCD2i3X47p8`
- Withdraw: `D5oEXsww1fnETGG6dro49Bz5atwXBANAhPwbocdex6Eb`

---

## Package Addresses (Mainnet)

| Package | Address |
|---|---|
| `storage` (core lending) | `0xd899cf7d2b5db716bd2cf55599fb0d5ee38a3061e7b6bb6eebf73fa5bc4c81ca` |
| `incentive_v3` (deposit/withdraw) | `0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb` |
| `incentive_v2` | `0xe66f07e2a8d9cf793da1e0bca98ff312b3ffba57228d97cf23a0613fddf31b65` |
| `oracle` | `0xca441b44943c16be0e6e23c5a955bb971537ea3289ae8016fbf33fffe1fd210f` |
| `oracle_pro` (price updater) | `0x203728f46eb10d19f8f8081db849c86aa8f2a19341b7fd84d7a0e74f053f6242` |

> **Package versioning:** Navi upgrades its package; the current `lending_core` package ID (where the callable `incentive_v3` entry functions live) is **`0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb`** (verify the latest via `GET https://open-api.naviprotocol.io/api/package`). Struct types keep their original-version addresses (`Storage`/`Pool` → v1 `0xd899…81ca`, `incentive_v2::Incentive` → `0xe66f…1b65`, `incentive_v3::Incentive` → `0x81c4…c18f`). Sweem's `Move.toml` pins a `lending_core` git rev — confirm its resolved `published-at` targets the current package above before a mainnet run.

---

## Mainnet Shared Object IDs

| Object | Type | ID |
|---|---|---|
| Clock | `0x2::clock::Clock` | `0x6` |
| SuiSystemState | `0x3::sui_system::SuiSystemState` | `0x5` |
| Storage | `storage::Storage` | `0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe` |
| OracleConfig | `oracle::OracleConfig` | `0x1afe1cb83634f581606cc73c4487ddd8cc39a944b951283af23f7d69d5589478` |
| PriceOracle | `oracle::PriceOracle` | `0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef` |
| IncentiveV2 | `incentive_v2::Incentive` | `0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c` |
| Incentive (V3) | `incentive_v3::Incentive` | `0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80` |

### USDC Pool (Mainnet)

| Field | Value |
|---|---|
| Coin type | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| Pool object | `0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8` |
| Asset ID | `10` (u8) |
| Decimals | 6 |
| Supply APY | ~5.28% |
| Minimum deposit | 5 USDC (5,000,000 raw) |

---

## No Testnet

**Navi has no usable testnet deployment.** The real lending market lives only on mainnet, so the real Navi route cannot be exercised on testnet — Sweem's testnet package uses the **stub** adapter (DF tracking + events, no fund movement). Integration-testing the real Navi route requires **mainnet with dust** (minimum 5 USDC per the pool's `minimumAmount`). Unit tests (`sui move test`) can only cover Sweem's own logic against the stubs, never the live market.

---

## AccountCap — Why It's Required

Navi's entry functions record positions under `ctx.sender()`. For Sweem, `ctx.sender()` is the org at invest time but the **employee** at claim time. Without AccountCap, the employee cannot withdraw a deposit made by the org.

`AccountCap` is an owned object acting as a standalone account inside Navi. Positions are tracked under the AccountCap's owner address — not `ctx.sender()`. Anyone holding the cap can access those positions.

**For Sweem:** the AccountCap is created externally via Navi's `lending_core::lending::create_account(ctx): AccountCap`, then handed to the adapter once per StreamPool via `store_pool_account_cap` (and once per vault bucket via `store_vault_account_cap`). It is stored as a dynamic object field under the `NaviPoolCapKey` / `NaviVaultCapKey` key structs. `sweem_adapters` manages it entirely — `sweem_core` never knows it exists. There is no `pool_setup_navi` function; creation happens in the PTB, storage happens in `store_*_account_cap`.

---

## Move Function Signatures (contract-level)

### Deposit

```rust
// package: incentive_v3
public fun deposit_with_account_cap<CoinType>(
    clock:        &Clock,
    storage:      &mut Storage,
    pool:         &mut Pool<CoinType>,
    asset:        u8,
    deposit_coin: Coin<CoinType>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    account_cap:  &AccountCap,
)
```
No return value. Position tracked internally in Storage under AccountCap's owner address.

### Withdraw

```rust
// package: incentive_v3 — the adapter uses this (NOT the _v2 variant)
public fun withdraw_with_account_cap<CoinType>(
    clock:        &Clock,
    oracle:       &PriceOracle,
    storage:      &mut Storage,
    pool:         &mut Pool<CoinType>,
    asset:        u8,
    amount:       u64,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    account_cap:  &AccountCap,
): Balance<CoinType>
```
Returns `Balance<CoinType>` — merged directly into `pool.balance` or `bucket.balance`. **No `SuiSystemState` and no separate oracle price-update call are required** by the adapter's withdraw path (the `0x5`/`oracle_pro` references below are not used by current code). Partial withdrawal is supported — pass the exact `amount` needed.

---

## PTB Structure

The adapter wraps the Navi calls — callers invoke the Sweem adapter functions below, not Navi directly. The internal Navi calls are:

### Deposit (inside `pool_invest_navi` / `vault_invest_navi`)

```
incentive_v3::deposit_with_account_cap<T>(...)   ← no oracle price-update call needed
```

### Withdrawal (inside `pool_withdraw_navi`, reached via the claim/cover entry points)

```
1. incentive_v3::withdraw_with_account_cap<T>(...) → Balance<T>
2. deduct yield fee → treasury; merge net into pool.balance
```

No `oracle_pro::update_single_price_v2` and no `SuiSystemState` are used by current code.

---

## Position Tracking

No receipt token. Navi tracks a scaled supply balance internally in `Storage`:

```
actual_value ≈ user_supply_balance * currentSupplyIndex / RAY
               RAY = 1e27
```

Sweem's `NaviPosition` dynamic field on the pool/bucket:

```
NaviPosition: has store
  deposited_value: u64   ← original raw tokens deposited (for yield fee calculation)
```

Yield fee calculation at withdrawal (matches source — Navi accrues yield to position size, aToken-style, so `principal_share` is `min(amount, deposited_value)`, not a proportional split):
```
gross           = withdrawn amount returned by Navi
principal_share = min(amount, deposited_value)
yield           = max(0, gross - principal_share)
fee             = yield * fee_bps / 10_000   (OZ u64 mul_div, rounds down)
net_to_pool     = gross - fee
deposited_value = deposited_value - principal_share   (reduced after withdraw)
```
Because Navi accrues yield into the position rather than as surplus on withdrawal, `yield` is ≈0 on partial withdrawals; the fee is realized primarily on a full exit.

---

## Sweem Adapter Functions

> Argument order below matches the source in `sweem_adapters/sources/navi.move`. There is no `pool_setup_navi`; the AccountCap is created via `lending_core::lending::create_account` in the PTB and registered with `store_pool_account_cap` / `store_vault_account_cap`.

### `store_pool_account_cap<T>` / `store_vault_account_cap` — one-time setup
```
public fun store_pool_account_cap<T>(pool: &mut StreamPool<T>, cap: AccountCap, ctx: &TxContext)   // org-only
public fun store_vault_account_cap(vault: &mut EmployeeVault, cap: AccountCap, ctx: &TxContext)     // owner-only
```
Stores the cap as a DOF under `NaviPoolCapKey` / `NaviVaultCapKey`.

### `pool_invest_navi<T>` — public, org-only
```
public fun pool_invest_navi<T>(
    pool:         &mut StreamPool<T>,
    storage:      &mut Storage,
    navi_pool:    &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    registry:     &ProtocolRegistry,
    clock:        &Clock,
    asset_id:     u8,
    amount:       u64,
    ctx:          &mut TxContext,
)
```
- Assert `is_approved(registry, "navi")`, `ctx.sender() == pool.org`, AccountCap present
- `split_balance_for_invest` (enforces coverage floor) → `deposit_with_account_cap`
- Upsert `NaviPosition.deposited_value += amount`
- (No on-chain minimum-deposit assert; respect Navi's own minimums off-chain.)

### `pool_withdraw_navi<T>` — `public(package)`, the internal withdraw primitive
```
public(package) fun pool_withdraw_navi<T>(
    pool:         &mut StreamPool<T>,
    storage:      &mut Storage,
    navi_pool:    &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    oracle:       &PriceOracle,
    config:       &ProtocolConfig,
    clock:        &Clock,
    registry:     &ProtocolRegistry,
    asset_id:     u8,
    amount:       u64,
    ctx:          &mut TxContext,
)
```
- Assert `is_approved`, AccountCap present; no sender auth — reached only via the package-internal callers below
- `withdraw_with_account_cap` → `Balance<T>`; deduct yield fee → `config.treasury`; merge net into `pool.balance`; reduce `NaviPosition.deposited_value`

### `cover_claim_from_navi<T>` — public, employee claim helper (split pools)
```
public fun cover_claim_from_navi<T>(
    pool, storage, navi_pool, incentive_v2, incentive_v3, oracle,
    config, clock, registry, asset_id, max_amount: u64, ctx,
)
```
Pulls up to `max_amount` of the **caller's own** claim shortfall (`claimable_amount(pool, ctx.sender()) − idle cash`) out of Navi into `pool.balance`. Does **not** claim. Compose in a PTB with other `cover_claim_from_*` calls and a terminal `stream_pool::claim`. Safe to be public: bounded by the caller's own claimable. Pass `max_amount` ≤ the current Navi position (over-asking aborts the claim rather than falling through to another protocol).

### `org_withdraw_navi<T>` — public, org-gated rebalance
```
public fun org_withdraw_navi<T>(
    pool, storage, navi_pool, incentive_v2, incentive_v3, oracle,
    config, clock, registry, asset_id, amount: u64, ctx,
)
```
Asserts `ctx.sender() == pool.org`, then unwinds `amount` from Navi to idle cash — for rebalancing (`org_withdraw_navi` → `pool_invest_<other>` in one PTB) or top-ups.

### `vault_invest_navi<T>` / `vault_withdraw_navi<T>` — public, employee-only
Same pattern scoped to a `TokenBucket`. Auth: `vault.owner == ctx.sender()`. Fee: `vault_yield_fee_bps`. `vault_withdraw_navi` takes an `amount` (partial supported).

---

## Open Questions

- [x] Mainnet shared-object IDs + `asset_id=10` verified on-chain (and via Navi `/api/navi/pools`); USDC min deposit = 5 USDC
- [ ] Confirm Sweem's pinned `lending_core` git rev resolves `published-at` to the current package `0x1e4a13a0…77259cb` (else calls hit an outdated package version)
