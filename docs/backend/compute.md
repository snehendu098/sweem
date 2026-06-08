# Compute

Off-chain calculations performed by the backend. These inform UI pre-fill and PTB construction — they are not authoritative. On-chain contracts re-verify everything.

---

## Rate Parameters

Streams are stored on-chain as `(rate_amount: u128, rate_period_ms: u64)` — the raw amount and the period it covers. Division is deferred to claim time using `oz_u128::mul_div(elapsed, rate_amount, rate_period_ms)`, which multiplies before dividing and avoids precision loss for small rates.

The backend computes these two values at fund time to pre-fill the PTB.

### MODE A — individual rate

```
MONTHLY:  rate_period_ms = 30 * 24 * 60 * 60 * 1_000  (= 2_592_000_000)
HOURLY:   rate_period_ms = 3_600 * 1_000               (= 3_600_000)
rate_amount = base_units of the token per period
```

Example (MONTHLY, 100 USDC at 6 decimals):
```
rate_amount    = 100_000_000
rate_period_ms = 2_592_000_000
```

After 10 days (864_000_000 ms):
```
claimable = 864_000_000 * 100_000_000 / 2_592_000_000 = 33_333_333 base units (~33.33 USDC)
```

With the old `slice_per_ms` approach `floor(100_000_000 / 2_592_000_000) = 0`, so the employee would earn nothing. The `(rate_amount, rate_period_ms)` pair preserves full precision.

### MODE B — percentage of group total

```
rate_amount    = floor(percentage / 100 * group_total_rate_amount)
rate_period_ms = group_total_rate_period_ms
```

`group_total_rate_amount` and `group_total_rate_period_ms` are provided by the org at deposit time. The backend stores them transiently for pre-fill.

### Multi-token

Each token has its own `EmployeeTokenRate` row and its own `StreamPool`. Rate params are computed independently per token.

---

## Runway

Estimated time (in ms) until the pool runs out of funds, assuming no topup.

```
active_rate_per_ms = sum(rate_amount / rate_period_ms for all ACTIVE streams)
runway_ms          = pool_balance_on_chain / active_rate_per_ms
```

`pool_balance_on_chain` is read from the Sui RPC (`StreamPool.balance`). The backend does not add yield position values — those are locked and not immediately liquid.

Displayed as days on the org dashboard:

```
runway_days = runway_ms / (24 * 60 * 60 * 1_000)
```

A stream is ACTIVE if `paused_at == None && stopped_at == None`.

---

## AUTO_MAX_YIELD

`AUTO_MAX_YIELD` is a virtual protocol — employees can set their VaultAllocation to route yield automatically to whichever protocol is currently offering the highest APY for a given token. The contract does not know about `AUTO_MAX_YIELD`; it always receives an explicit protocol name.

The backend resolves `AUTO_MAX_YIELD` off-chain before the employee constructs their claim PTB:

```
GET /compute/max-yield?token=USDC
→ { protocol: "SCALLOP", apy: 8.2 }
```

The resolution logic:

1. Fetch current APY for each supported L-type protocol (Navi, Scallop) for the requested token
2. Return the protocol with the highest APY
3. The frontend passes this explicit protocol name to the claim PTB

### APY Sources

| Protocol | Source |
|---|---|
| Navi | `https://open-api.naviprotocol.io/api/pool` — public, no API key |
| Scallop | `https://sdk.api.scallop.io/api/market/migrate` — public, no API key |

### Caching

APY lookups are cached in memory for the lifetime of the Worker instance (short TTL, no persistent cache). Stale APY causes no financial harm — the employee simply ends up in a slightly lower-yield protocol for one claim cycle.

---

## Claimable Amount (read-only, no DB)

The backend can pre-compute claimable amounts from on-chain state for the employee dashboard. This mirrors the on-chain formula exactly:

```
effective_end = paused_at ?? stopped_at ?? current_clock_ms
new_earned    = (effective_end - claimed_at - total_paused_ms) * rate_amount / rate_period_ms
claimable     = pending_balance + new_earned
```

`pending_balance` is a u64 field crystallized on-chain whenever the org updates a stream's rate mid-period. It stores earnings accrued at the old rate so they are never lost.

Values are read from the `Stream` inside the `StreamPool` on-chain object via Sui RPC. The backend never stores these — always read live.

---

## Effective Claimable Display

The raw `claimable_amount` from the on-chain formula tells the employee how much they have *earned*. But if the pool is underfunded, they may not be able to withdraw it all right now. The UI should reflect this.

### Formula

```
effective_claimable = min(claimable_earned, pool_idle_cash + scallop_position_value)
```

### Fetching components

| Component | Source |
|---|---|
| `claimable_earned` | On-chain formula (see Claimable Amount section above) |
| `pool_idle_cash` | `StreamPool.balance.value()` — Sui RPC |
| `scallop_position_value` | `ScallopPosition.deposited_value` DF on pool UID — Sui RPC |

`deposited_value` from the DF is intentionally conservative — it under-counts by any yield accrued in Scallop, so it never overstates available funds.

### What to show in the UI

| State | Display |
|---|---|
| `effective_claimable == claimable_earned` | "Claim X USDC" — pool is solvent |
| `effective_claimable < claimable_earned` | "Claim X USDC now · Y USDC pending top-up" |
| `effective_claimable == 0` | "Pool currently underfunded — contact your employer" |

The stream ticker should still show `claimable_earned` advancing in real time — this is what the employee has earned and is legally owed. Only the "Claim now" button amount reflects what can actually be withdrawn today.

---

## Notes

- All token amounts are in base units (e.g. USDC at 6 decimals = multiply display value by 1_000_000)
- Integer division throughout — no floating point in rate calculations
- Runway is an estimate; yield positions are counted as liquid for solvency display but not for runway (runway uses idle cash only)
