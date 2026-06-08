# Revenue Model

Sweem charges three fees across two sides of the protocol. Employees always receive their full salary — no deductions at claim time.

---

## Competitor Landscape

| Protocol | Chain | Fee | Who pays |
|---|---|---|---|
| Streamflow | Solana | 0.25% on streamed amount | Sender (org) |
| Sablier | EVM | $1 flat per withdrawal | Recipient (sponsorable by sender) |
| Superfluid | EVM | None (fee switch planned in V2) | — |
| LlamaPay | EVM | None — free | — |

Key takeaway: the only protocol charging meaningful fees on the sender side is Streamflow at 0.25%. Sablier charges recipients a flat $1. LlamaPay and Superfluid charge nothing. Sweem's yield layer is a differentiator none of them have.

---

## Fee 1: Deposit Fee (org side)

**Charged to:** org
**When:** at every `deposit` and `topup` call
**Config field:** `ProtocolConfig.deposit_fee_bps`
**Suggested launch value:** 25 bps (0.25%) — matches Streamflow

```
gross = payment amount
fee   = gross * deposit_fee_bps / 10_000
net   = gross - fee

Treasury receives: fee
StreamPool receives: net (this is what employees will stream from)
```

**Why at deposit, not at claim:**
Charging at deposit means the org pays once when they fund. Employees receive their full claimable amount at claim time — no salary deduction. This is better UX for employees and simpler accounting for orgs (one fee event per funding action, not one per claim across every employee).

---

## Fee 2: Org Yield Fee (org side)

**Charged to:** org
**When:** when yield positions in `StreamPool` are unwound — triggered by employee claims drawing down the pool balance past `pool.balance`, or by explicit org withdrawals from yield positions
**Config field:** `ProtocolConfig.org_yield_fee_bps`
**Suggested launch value:** 1000 bps (10%)

```
At pool_withdraw_<protocol> time:
  withdrawn             = amount returned by yield protocol
  proportional_deposit  = deposited_value * (withdrawn / total_position_value)
  yield                 = withdrawn - proportional_deposit
  fee                   = yield * org_yield_fee_bps / 10_000
  net_to_pool           = withdrawn - fee

Treasury receives: fee
StreamPool.balance receives: net_to_pool
```

**Why the org still benefits:**
The fee is only on the yield portion. The principal is always returned in full. The remaining yield (after fee) still extends the pool's runway. The org earns yield on idle payroll for free — Sweem takes a cut only when that yield is actually realized.

**Edge case — yield never explicitly withdrawn:**
If `pool.balance` is always sufficient to pay claims (org keeps topping up), yield positions are never unwound and this fee never triggers. This is acceptable for v1. A future "harvest yield" function could let orgs explicitly realize yield, at which point the fee applies.

---

## Fee 3: Vault Yield Fee (employee side)

**Charged to:** employee
**When:** when yield positions in `EmployeeVault` `TokenBucket` are withdrawn
**Config field:** `ProtocolConfig.vault_yield_fee_bps`
**Suggested launch value:** 1000 bps (10%)

```
At vault_withdraw_<protocol> time:
  withdrawn            = amount returned by yield protocol
  proportional_deposit = deposited_value * (withdrawn / total_position_value)
  yield                = withdrawn - proportional_deposit
  fee                  = yield * vault_yield_fee_bps / 10_000
  net_to_bucket        = withdrawn - fee

Treasury receives: fee
TokenBucket.balance receives: net_to_bucket (principal + yield - fee)
```

**Why only on yield, not principal:**
Employees own their salary in full. Charging on principal would feel like taxing income twice. Charging only on vault yield means Sweem earns when the employee's investment strategy earns — aligned incentives.

---

## Fee Configuration

All fees stored in `ProtocolConfig` in `sweem_registry`. Updated by `AdminCap` holder via `set_fees` — no contract upgrade needed.

```
deposit_fee_bps:     u64   ← hard cap: 500  (5% max)
org_yield_fee_bps:   u64   ← hard cap: 5000 (50% max)
vault_yield_fee_bps: u64   ← hard cap: 5000 (50% max)
treasury:            address
```

Hard caps are enforced in the contract — even with `AdminCap`, fees cannot exceed these limits.

---

## Revenue Summary

| Fee | Payer | Scales with | Predictability |
|---|---|---|---|
| Deposit fee | Org | Total payroll capital deployed | High — every deposit |
| Org yield fee | Org | TVL × yield APY on unclaimed funds | Medium — depends on yield rates |
| Vault yield fee | Employee | Employee vault TVL × vault yield APY | Medium — depends on vault activity |

---

## What Is Never Charged

- Employee salary principal — employees always receive their full claimable amount
- Pause / stop / resume operations
- Vault creation
- Protocol registry reads
