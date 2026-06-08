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

## Testnet

Navi has a full testnet deployment with test tokens. Testnet is the environment for integration testing Sweem's adapter before mainnet.

### Testnet USDC Pool

| Field | Value |
|---|---|
| Coin type | `0x6dbe9f683727ea558b4a13101d9fd9dbe540a0c9e06f18021d7300b5de73636f::usdc_test::USDC_TEST` |
| Pool object | `0xd324a1fa7780de7a14b0c5af38e0c3b03d9cf1ad4b9c731be2d74138d84346b5` |
| Asset ID | `1` (u8) |
| Decimals | 6 |
| Supply APY | ~2.89% |
| Minimum deposit | 100 USDC_TEST (100,000,000 raw) — higher than mainnet |

### Other Testnet Pools Available

| Symbol | Asset ID | Coin type |
|---|---|---|
| SUI_TEST | 0 | `0x4c5296cbd5d0a8f6e78e84817f0b277ffdf27b7c4ef2af5a5cec85419a637291::sui_test::SUI_TEST` |
| USDC_TEST | 1 | `0x6dbe9f683727ea558b4a13101d9fd9dbe540a0c9e06f18021d7300b5de73636f::usdc_test::USDC_TEST` |
| BTC_TEST | 2 | `0xc9690f358882c6e5b109acf4171bce4414b1cfd5bb3f305e2150b4e802c4ea52::btc_test::BTC_TEST` |

### Testnet Global Object IDs

Testnet Storage, IncentiveV2, IncentiveV3, PriceOracle IDs are different from mainnet.
- [ ] To be confirmed from a testnet deposit transaction

---

## AccountCap — Why It's Required

Navi's entry functions record positions under `ctx.sender()`. For Sweem, `ctx.sender()` is the org at invest time but the **employee** at claim time. Without AccountCap, the employee cannot withdraw a deposit made by the org.

`AccountCap` is an owned object acting as a standalone account inside Navi. Positions are tracked under the AccountCap's owner address — not `ctx.sender()`. Anyone holding the cap can access those positions.

**For Sweem:** the AccountCap is created once per StreamPool via `pool_setup_navi` and stored as a dynamic object field on the StreamPool under key `"navi_account_cap"`. `sweem_adapters` manages it entirely — `sweem_core` never knows it exists.

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
// package: incentive_v3
public fun withdraw_with_account_cap_v2<CoinType>(
    clock:        &Clock,
    oracle:       &PriceOracle,
    storage:      &mut Storage,
    pool:         &mut Pool<CoinType>,
    asset:        u8,
    amount:       u64,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    account_cap:  &AccountCap,
    system_state: &mut SuiSystemState,
    ctx:          &mut TxContext,
): Balance<CoinType>
```
Returns `Balance<CoinType>` — merged directly into `pool.balance` or `bucket.balance`.

---

## PTB Structure

### Deposit PTB (org)

```
1. oracle_pro::update_single_price_v2(...)        ← always first, freshens oracle price
2. incentive_v3::deposit_with_account_cap<T>(...)
```

### Withdrawal PTB (internal — called from claim_with_liquidity only)

```
1. oracle_pro::update_single_price_v2(...)        ← always first
2. incentive_v3::withdraw_with_account_cap_v2<T>(...) → Balance<T>
3. merge Balance<T> into pool.balance
```

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

Yield fee calculation at withdrawal:
```
proportional_deposit = deposited_value * withdrawn / total_position_value
yield                = withdrawn - proportional_deposit
fee                  = yield * fee_bps / 10_000
net_to_pool          = withdrawn - fee
```

---

## Sweem Adapter Functions

### `pool_setup_navi<T>` — public, org calls once after pool creation
Creates AccountCap via Navi, stores as DOF on StreamPool under `"navi_account_cap"`.

### `pool_invest_navi<T>` — public, org-only
```
public fun pool_invest_navi<T>(
    pool:         &mut StreamPool<T>,
    registry:     &ProtocolRegistry,
    storage:      &mut Storage,
    navi_pool:    &mut Pool<T>,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    amount:       u64,
    clock:        &Clock,
    ctx:          &mut TxContext,
)
```
- Assert `registry::is_approved(registry, "navi")`
- Assert `ctx.sender() == pool.org`
- Assert `amount >= 5_000_000` (mainnet minimum)
- Borrow AccountCap DOF from pool
- Call `deposit_with_account_cap`
- Upsert `NaviPosition` DOF: add `amount` to `deposited_value`

### `pool_withdraw_navi<T>` — public(package), called only from claim_with_liquidity
```
public(package) fun pool_withdraw_navi<T>(
    pool:         &mut StreamPool<T>,
    registry:     &ProtocolRegistry,
    config:       &ProtocolConfig,
    storage:      &mut Storage,
    navi_pool:    &mut Pool<T>,
    oracle:       &PriceOracle,
    incentive_v2: &mut IncentiveV2,
    incentive_v3: &mut Incentive,
    system_state: &mut SuiSystemState,
    amount:       u64,
    clock:        &Clock,
    ctx:          &mut TxContext,
)
```
- Assert `registry::is_approved(registry, "navi")`
- No external auth — visibility enforced by `public(package)`
- Borrow AccountCap DOF from pool
- Call `withdraw_with_account_cap_v2` → `Balance<T>`
- Deduct yield fee → send to `config.treasury`
- Merge net into `pool.balance`
- Reduce `NaviPosition.deposited_value` proportionally

### `vault_invest_navi<T>` / `vault_withdraw_navi<T>` — public, employee-only
Same pattern scoped to `TokenBucket`. Auth: `vault.owner == ctx.sender()`. Fee: `vault_yield_fee_bps`.

---

## Open Questions

- [ ] Exact Move path for `create_account_cap` (needed for `pool_setup_navi`)
- [ ] Confirm `deposit_with_account_cap` module path (incentive_v3 or base storage module)
- [ ] Testnet global object IDs (Storage, IncentiveV2, IncentiveV3, PriceOracle) — get from a testnet tx
