# Sweem

Sweem is a streaming payroll protocol on Sui. Organizations deposit funds into payment groups and stream salaries to employees per millisecond. Unclaimed funds are invested in yield protocols, earning yield for the organization. When employees claim, they can route their funds into personal vaults with custom yield strategies.

# Storage and Data

Storage is split across two layers — database for metadata, Sui contracts for financial state. The data model and split is fully documented in `data/README.md` and `data/models.yml`.

# System Overview

**Payment Groups**
- An org creates one `StreamPool<T>` per token type. All employees paid in that token share the pool.
- Employee groups (e.g. "Engineering", "Marketing") are a UI concept — they are labels stored in the backend database mapping group name → employee addresses. On-chain, all employees are entries in the same `streams: Table<address, Stream>`.
- This design keeps on-chain objects minimal and leverages Sui's parallel execution — separate pools for separate token types, not separate pools per department.
- When funding multiple groups, the frontend constructs a single PTB: `splitCoins` the org's coin, then `deposit`/`topup` each pool in the same atomic transaction.
- Employees can be paused (temporary) or stopped (permanent) at any time — the org toggles pause/resume per employee from the Payroll dashboard
- Removed employees can still claim their already-earned funds; freed funds stay in the pool to extend runway for remaining employees
- Payment mode A: individual rate per employee (monthly or hourly) — stored as `(rate_amount, rate_period_ms)` on-chain
- Payment mode B: org sets total group stream rate, each employee gets a percentage of it

**Unclaimed Funds**
- While funds sit unclaimed they are invested in yield protocols chosen by the org at deposit/topup time
- Yield accrues to the organization
- Supported yield types: Lending Protocols (L), Yield Bearing Stablecoins (Y), LSTs (S)
- Org can split across multiple protocols (or keep some/all idle) — positions coexist on one pool
- Claims against a split pool draw liquidity across all of them in a single PTB (`cover_claim_from_<protocol>` × N → `claim`); the org can rebalance protocol→protocol via `org_withdraw_<protocol>`

**Claiming**
- Claimable amount computed live: `(effective_end - last_claimed_at - total_paused_ms) * rate_amount / rate_period_ms`
- Employees can claim while paused or stopped (up to the point streaming stopped)
- On claim, employees specify a target vault and yield routing inline — funds are swapped and deposited atomically in one PTB

# Employee Vaults

Employees can create multiple named vaults. Each vault is multi-token and routes funds across:

- **L** — Lending Protocols (e.g. Scallop, Navi)
- **Y** — Yield Bearing Stablecoins (e.g. USDY)
- **S** — LSTs (e.g. Bucket)

For each allocation employees specify a percentage and either a specific protocol or `AUTO_MAX_YIELD`. `AUTO_MAX_YIELD` is resolved off-chain by the frontend — the contract always receives an explicit protocol. Swaps between token types are handled in the same claim transaction via PTBs.
