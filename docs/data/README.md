# Data Model

Sweem splits storage across two layers: a database for metadata and display, and Sui contracts for financial source of truth.

## DB Layer

Holds everything that doesn't need on-chain verification.

- **Organization** — wallet address as identity, plus profile info (name, logo)
- **PaymentGroup** — named group of employees under an org. Token config lives in `PaymentGroupPool`
- **PaymentGroupPool** — one row per token per group. Each row references an on-chain `StreamPool`. Adding a new token to a group = new row here + new `StreamPool` deployment, no contract changes
- **Employee** — alias and wallet per group. Payment rates live in `EmployeeTokenRate`
- **EmployeeTokenRate** — one row per token per employee. Supports two modes: individual rate (monthly/hourly) or percentage of group total. Token must match a `PaymentGroupPool` entry for that group
- **EmployeeVault** — named vault owned by an employee, holds a reference to its on-chain object
- **VaultAllocation** — per-token yield routing config for a vault (L/Y/S split, protocol choice). UI pre-fill only — not source of truth
- **LastYieldRoute** — last yield routing used by an org on deposit, scoped per `PaymentGroupPool` (per token). UI pre-fill only

## Contract Layer

Holds all financial state. See `models.yml` for full field definitions.

- **StreamPool** — shared object, one per `PaymentGroupPool` (one per token per group). Holds the token pool (`Balance<T>`), running deposit/claim totals, all employee streams, and yield protocol positions as dynamic fields
- **Stream** — per-employee record nested inside StreamPool. Tracks `slice_per_ms`, claim timestamp, pause/stop state, and accumulated paused duration. Three states: ACTIVE, PAUSED, STOPPED
- **EmployeeVault** — owned object held by the employee. Multi-token: each token is a dynamic field (`TokenBucket`) which itself holds yield positions per protocol

## Key Rules

- Multi-token support is achieved by having multiple `StreamPool` objects per group (one per token) — the contract itself never changes when a new token is added
- `slice_per_ms` is calculated at fund time from the employee's `EmployeeTokenRate` for that token and stored on-chain
- Claimable amount is always computed live: `(effective_end - claimed_at - total_paused_ms) * slice_per_ms`
- `AUTO_MAX_YIELD` is resolved off-chain by the frontend; the contract always receives an explicit protocol
- Yield routing is specified inline at deposit (org) and claim (employee) time — no separate configuration step
- Freed funds from removed employees stay in the pool, extending runway for remaining streams
