# Scallop Protocol Integration

Scallop is a money market on Sui. Sweem uses it for the **L (Lending)** yield type on `StreamPool` and `TokenBucket` positions — the same category as Navi.

---

## Key Difference from Navi

Scallop is **sender-based**. No `AccountCap` is required. Deposits return a receipt token (`Coin<MarketCoin<T>>` — called sCoin) that is stored on the pool/vault. Withdrawals burn the sCoin and return the underlying asset including accrued interest. Sweem stores the sCoin as a DOF and the tracked principal as a DF.

| | Navi | Scallop |
|---|---|---|
| Auth | `AccountCap` (DOF on pool/vault) | None — sender-based |
| Deposit result | Internal accounting in `Storage` | Returns `Coin<MarketCoin<T>>` (sCoin) |
| Withdrawal input | `amount: u64` (partial supported) | Full sCoin (full-position close) |
| Pool ID | `asset_id: u8` | Type parameter only |
| Oracle required | Yes (`PriceOracle` on withdraw) | No |

---

## Package

```toml
# Move.toml
protocol = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "contracts/protocol", rev = "main" }
```

**Protocol named address:** `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`
**Package ID (published-at):** `0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`

The MVR name `lending@scallop/core` resolves to this package but has no git URL registered — use the git URL directly.

---

## Mainnet Shared Object IDs

| Object | Type | ID |
|---|---|---|
| Version | `protocol::version::Version` | `0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7` |
| Market | `protocol::market::Market` | `0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9` |
| Coin Decimals Registry | `CoinDecimalsRegistry` | `0x200abe9bf19751cc566ae35aa58e2b7e4ff688fc1130f8d8909ea09bc137d668` |

## Testnet Shared Object IDs

Scallop has a live testnet deployment — use real Scallop objects for integration testing instead of the stub adapter.

| Object | Type | ID |
|---|---|---|
| Version | `protocol::version::Version` | `0xee15d07800e2ad4852505c57cd86afea774af02c17388f8bd907de75f915b4f4` |
| Market | `protocol::market::Market` | `0xa7f41efe3b551c20ad6d6cea6ccd0fd68d2e2eaaacdca5e62d956209f6a51312` |

---

## Move Function Signatures

### Deposit (Mint)

```move
// module: protocol::mint
public fun mint<T>(
    version: &Version,
    market:  &mut Market,
    coin:    Coin<T>,
    clock:   &Clock,
    ctx:     &mut TxContext,
): Coin<MarketCoin<T>>
```

Returns `Coin<MarketCoin<T>>` — the sCoin receipt. The **amount of sCoin you hold never changes** after mint; what changes is the exchange rate. Each sCoin becomes redeemable for progressively more of the underlying token as interest accrues (same model as Compound's cTokens).

### Withdraw (Redeem)

```move
// module: protocol::redeem
public fun redeem<T>(
    version: &Version,
    market:  &mut Market,
    coin:    Coin<MarketCoin<T>>,
    clock:   &Clock,
    ctx:     &mut TxContext,
): Coin<T>
```

Burns the sCoin and returns underlying `Coin<T>` at the current exchange rate. The returned amount will be greater than the original deposit by the accrued interest. No partial redemption — the full sCoin balance must be passed in one call.

### Key Types

```move
// module: protocol::reserve
struct MarketCoin<phantom T> has drop {}   // phantom type — Coin<MarketCoin<T>> has key+store

// module: protocol::version
struct Version has key, store { id: UID, value: u64 }

// module: protocol::market
struct Market has key, store { ... }
```

---

## Position Storage

Scallop has no internal per-user accounting — the sCoin IS the position. Sweem stores it as a DOF on the pool/vault UID.

```
Pool UID / Bucket UID:
  ScallopPoolMarketCoinKey  → DOF → Coin<MarketCoin<T>>   (the sCoin)
  ScallopPoolPositionKey    → DF  → ScallopPosition { deposited_value: u64 }
```

Because the sCoin exchange rate model means the **sCoin amount is static** (it never increases while sitting in the DOF), Sweem never needs to update the stored `Coin<MarketCoin<T>>` between invest and redeem calls. Multiple `pool_invest_scallop` calls accumulate via `Coin::join` into the single stored sCoin. The yield silently accrues inside the Market as a rising exchange rate.

`deposited_value` tracks the total original USDC (or whichever token T) deposited across all invest calls. At redemption, `gross - deposited_value` is the yield earned. This is correct precisely because sCoin is not rebasing — the amount deposited is a stable baseline to compare against.

---

## Yield Fee Calculation

Because sCoin is exchange-rate-based (not rebasing), yield is simply the difference between what came back from `redeem` and what was originally deposited:

```
gross          = redeem(market_coin).value()   // e.g. 105 USDC
deposited_value = 100 USDC                     // tracked at invest time
yield_earned   = max(0, gross - deposited_value)  // = 5 USDC
fee            = yield_earned * fee_bps / 10_000  (OZ mul_div, rounds down)
net_to_pool    = gross - fee
```

`fee` is transferred to `treasury(config)`. `net_to_pool` is merged back into `pool.balance` (or `bucket.balance` for vaults).

**Why this formula works:** the sCoin amount never changed between invest and redeem — only the exchange rate did. So `deposited_value` (original USDC in) is a clean baseline. No proportional scaling is needed unlike Navi's partial-withdrawal formula.

Withdrawals are always full-position closes. After `pool_withdraw_scallop`, the pool has zero Scallop position and the org re-invests on the next deposit/topup cycle.

---

## Sweem Adapter Functions

### `pool_invest_scallop<T>` — public, org-only

```move
public fun pool_invest_scallop<T>(
    pool:     &mut StreamPool<T>,
    version:  &Version,
    market:   &mut Market,
    registry: &ProtocolRegistry,
    clock:    &Clock,
    amount:   u64,
    ctx:      &mut TxContext,
)
```

- Assert `is_approved(registry, "scallop")`
- Assert `ctx.sender() == pool.org`
- `split_balance_for_invest(pool, amount)` → `Coin<T>`
- `mint(version, market, coin, clock, ctx)` → `Coin<MarketCoin<T>>`
- DOF add-or-join sCoin on pool UID under `ScallopPoolMarketCoinKey`
- DF add-or-update `ScallopPosition.deposited_value += amount`
- Emit `ScallopInvested`

No setup step required — no AccountCap to create or store.

### `pool_withdraw_scallop<T>` — `public(package)`, called only from `claim_liquidity_scallop`

```move
public(package) fun pool_withdraw_scallop<T>(
    pool:     &mut StreamPool<T>,
    version:  &Version,
    market:   &mut Market,
    config:   &ProtocolConfig,
    registry: &ProtocolRegistry,
    clock:    &Clock,
    ctx:      &mut TxContext,
)
```

- Assert approved
- `dof::remove` sCoin from pool UID
- `redeem(version, market, market_coin, clock, ctx)` → `Coin<T>`
- Compute yield fee, transfer to treasury
- `merge_balance_from_yield(pool, net)`
- `df::remove` `ScallopPosition` from pool UID
- Emit `ScallopReturned`

Redeems the **entire** position. After this call, the pool has no Scallop position — the org re-invests on the next deposit/topup cycle.

### `vault_invest_scallop<T>` / `vault_withdraw_scallop<T>` — public, employee-only

Same pattern as pool functions, scoped to a `TokenBucket` inside the employee's `EmployeeVault`. Auth: `vault.owner == ctx.sender()`. Fee rate: `vault_yield_fee_bps`.

---

## Claim Entry Point

```move
// module: sweem_adapters::claim_liquidity_scallop
public fun claim_with_liquidity_scallop<T>(
    pool:     &mut StreamPool<T>,
    version:  &Version,
    market:   &mut Market,
    registry: &ProtocolRegistry,
    config:   &ProtocolConfig,
    clock:    &Clock,
    ctx:      &mut TxContext,
): Coin<T>
```

1. Compute `claimable = stream_pool::claimable_amount(pool, sender, clock)`
2. If `pool.balance < claimable`: call `pool_withdraw_scallop` (redeems full Scallop position into cash)
3. Assert `pool.balance >= claimable` — aborts with `EInsufficientPoolLiquidity` if still short
4. Call `stream_pool::claim` — returns `Coin<T>` to employee

The happy path (pool has enough cash) costs nothing extra — Scallop redemption only triggers when cash runs short.

---

## PTB Structure

### Invest PTB (org)

```
1. sweem_adapters::scallop::pool_invest_scallop<T>(pool, version, market, registry, clock, amount, ctx)
```

Single call. No oracle update required (Scallop mint does not need a price feed).

### Claim PTB (employee, Scallop pool)

```
1. sweem_adapters::claim_liquidity_scallop::claim_with_liquidity_scallop<T>(...)  → Coin<T>
2. PTB splitCoins                                                                   → vault portion + wallet portion
3. sweem_core::employee_vault::deposit_to_bucket<T>(vault, token_name, vault_coin)
4. sweem_adapters::scallop::vault_invest_scallop<T>(vault, token_name, ...)       → if routing to Scallop
5. PTB transferObjects(wallet_coin, employee_address)
```

---

## Registry Setup (admin, one-time)

After deploying `sweem_adapters`, call:

```move
registry::add_protocol(
    &mut registry,
    &ac,
    b"scallop",
    @sweem_adapters,
    0,    // yield_type: 0 = Lending (L)
    ctx,
);
```

---

## Open Questions

- [ ] Confirm `Version` and `Market` shared object IDs from a live mainnet transaction
- [ ] Confirm Scallop whitelist policy — `mint`/`redeem` call `market::assert_whitelist_access(market, ctx)`. Verify this is open to all callers on mainnet
- [ ] Scallop testnet deployment — check if a testnet version exists for integration testing (otherwise use the stub adapter)
