# Scallop Protocol Integration

Scallop is a money market on Sui. Sweem uses it for the **L (Lending)** yield type on `StreamPool` and `TokenBucket` positions — the same category as Navi.

---

## Key Difference from Navi

Scallop is **sender-based**. No `AccountCap` is required. Deposits return a receipt token (`Coin<MarketCoin<T>>` — called sCoin) that is stored on the pool/vault. Withdrawals burn the sCoin and return the underlying asset including accrued interest. Sweem stores the sCoin as a DOF and the tracked principal as a DF.

| | Navi | Scallop |
|---|---|---|
| Auth | `AccountCap` (DOF on pool/vault) | None — sender-based |
| Deposit result | Internal accounting in `Storage` | Returns `Coin<MarketCoin<T>>` (sCoin) |
| Pool withdrawal | partial (`amount`) | **partial** — adapter splits the stored sCoin to redeem only what's needed |
| Vault withdrawal | partial (`amount`) | full position (no `amount` arg) |
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

## No Testnet

**Scallop has no usable testnet deployment for this purpose.** Like Navi, the real money market is mainnet-only, so Sweem's testnet package uses the **stub** Scallop adapter (no fund movement). The real Scallop route can only be integration-tested on **mainnet with dust**; unit tests cover Sweem's own logic against the stub.

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

Burns whatever sCoin `Coin<MarketCoin<T>>` you pass and returns the underlying `Coin<T>` at the current exchange rate. Scallop's primitive redeems exactly the coin handed to it — so Sweem achieves **partial** withdrawal by `split`-ing the stored sCoin first and redeeming only that fraction, leaving the remainder invested. (The raw primitive has no "redeem N of M" arg; the split happens in the adapter.)

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

Because the sCoin exchange rate model means the **sCoin amount is static** (it never increases while sitting in the DOF), the value of the position grows purely via the rising exchange rate. Multiple `pool_invest_scallop` calls accumulate via `Coin::join` into the single stored sCoin. On a partial withdraw the adapter `split`s the exact sCoin fraction needed and leaves the rest in the DOF; on a full withdraw it removes the whole sCoin. The yield silently accrues inside the Market as a rising exchange rate.

`deposited_value` tracks the total original USDC (or whichever token T) deposited across all invest calls. At redemption, `gross - deposited_value` is the yield earned. This is correct precisely because sCoin is not rebasing — the amount deposited is a stable baseline to compare against.

---

## Yield Fee Calculation

Yield is `gross - principal_share`, where `principal_share` is the portion of `deposited_value` attributable to the sCoin actually redeemed.

**Full redemption** (vault withdraws; pool withdraws where the needed sCoin ≥ the whole position):
```
gross           = redeem(market_coin).value()   // e.g. 105 USDC
principal_share = deposited_value               // whole baseline, e.g. 100 USDC
yield_earned    = max(0, gross - principal_share)  // = 5 USDC
fee             = yield_earned * fee_bps / 10_000  (OZ mul_div, rounds down)
net             = gross - fee
```

**Partial pool redemption** (`pool_withdraw_scallop` with a `shortfall` smaller than the position): the adapter splits `scoin_to_redeem = ceil(shortfall * supply / backing) + 1` from the stored sCoin and pro-rates the principal:
```
principal_share = ceil(deposited_value * scoin_to_redeem / total_scoin)   // rounds UP
yield_earned    = max(0, gross - principal_share)
fee             = yield_earned * fee_bps / 10_000
deposited_value = deposited_value - principal_share   // position kept, baseline reduced
```
Rounding `principal_share` up means yield (and therefore the fee) is never overcounted on a partial close.

`fee` is transferred to `treasury(config)`. `net` is merged back into `pool.balance` (or `bucket.balance` for vaults).

After a **partial** `pool_withdraw_scallop` the remainder stays invested; only a full redeem zeroes the position (then the org re-invests on the next deposit/topup cycle). `vault_withdraw_scallop` always closes the full bucket position.

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

### `pool_withdraw_scallop<T>` — `public(package)`, the internal withdraw primitive

```move
public(package) fun pool_withdraw_scallop<T>(
    pool:      &mut StreamPool<T>,
    version:   &Version,
    market:    &mut Market,
    config:    &ProtocolConfig,
    registry:  &ProtocolRegistry,
    clock:     &Clock,
    shortfall: u64,
    ctx:       &mut TxContext,
)
```

- Assert approved, sCoin position exists
- Read the Market exchange rate; compute `scoin_to_redeem = ceil(shortfall * supply / backing) + 1`, capped at the full stored sCoin
- If it covers the whole position → `dof::remove` the sCoin and `df::remove` the `ScallopPosition`; otherwise `split` only `scoin_to_redeem` and keep the rest, reducing `deposited_value`
- `redeem(...)` → `Coin<T>`; compute yield fee (full or pro-rated), transfer to treasury; `merge_balance_from_yield(pool, net)`
- Emit `ScallopReturned`

**Partial redemption** — only the sCoin needed for `shortfall` is redeemed; the remainder stays invested. Reached via `claim_with_liquidity_scallop`, `cover_claim_from_scallop`, and `org_withdraw_scallop`.

### `cover_claim_from_scallop<T>` — public, employee claim helper (split pools)
```move
public fun cover_claim_from_scallop<T>(
    pool, version, market, config, registry, clock, max_amount: u64, ctx,
)
```
Pulls up to `max_amount` of the **caller's own** claim shortfall (`claimable_amount(pool, ctx.sender()) − idle cash`) out of Scallop into `pool.balance`; does **not** claim. Compose in a PTB with other `cover_claim_from_*` calls and a terminal `stream_pool::claim`. Safe to be public — bounded by the caller's own claimable. Scallop self-caps redemption to the position, so `max_amount` may be the full shortfall.

### `org_withdraw_scallop<T>` — public, org-gated rebalance
```move
public fun org_withdraw_scallop<T>(
    pool, version, market, config, registry, clock, amount: u64, ctx,
)
```
Asserts `ctx.sender() == pool.org`, then unwinds `amount` (underlying) from Scallop to idle cash — for rebalancing or top-ups.

### `vault_invest_scallop<T>` / `vault_withdraw_scallop<T>` — public, employee-only

Scoped to a `TokenBucket` inside the employee's `EmployeeVault`. Auth: `vault.owner == ctx.sender()`. Fee rate: `vault_yield_fee_bps`. Note `vault_withdraw_scallop` takes **no** `amount` — it always closes the full bucket position.

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
2. If `pool.balance < claimable`: call `pool_withdraw_scallop(shortfall)` — redeems only the sCoin needed for the shortfall; the rest stays invested
3. Assert `pool.balance >= claimable` — aborts with `EInsufficientPoolLiquidity` if still short
4. Call `stream_pool::claim` — returns `Coin<T>` to employee

The happy path (pool has enough cash) costs nothing extra — Scallop redemption only triggers when cash runs short.

For a pool **split across Scallop and another protocol**, use the composable path instead of this single-protocol entry: chain `cover_claim_from_scallop` + `cover_claim_from_<other>` + `stream_pool::claim` in one PTB (see `docs/implemented/sweem_adapters.md` → "Multi-Protocol Pools").

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

- [ ] Re-verify the `Version` and `Market` shared-object IDs above with `sui client object <id>` before any mainnet run
- [ ] Confirm Scallop whitelist policy — `mint`/`redeem` call `market::assert_whitelist_access(market, ctx)`. Verify this is open to all callers on mainnet
