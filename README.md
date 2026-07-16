# Sweem

Streaming payroll protocol on **Sui**. Organizations deposit funds into payment groups and stream salaries to employees per millisecond. Unclaimed funds are invested in yield protocols, earning yield for the org. When employees claim, they route funds into personal vaults with custom yield strategies.

---

## System Overview

Sweem splits state across two layers: a database for metadata (labels, employee↔group mapping) and Sui Move contracts for all financial state.

**Payment groups.** An org creates one `StreamPool<T>` per token type; every employee paid in that token shares the pool. Departments ("Engineering", "Marketing") are UI labels in the DB, not separate on-chain objects — all employees are entries in one `streams: Table<address, Stream>`. This keeps on-chain objects minimal and leverages Sui parallel execution (one pool per token, not per department). Funding multiple groups is a single PTB: `splitCoins` → `deposit`/`topup` each pool atomically. Employees can be paused (temporary) or stopped (permanent); removed employees can still claim already-earned funds.

**Unclaimed funds → yield.** While funds sit unclaimed they are invested in yield protocols chosen by the org at deposit/topup. Yield accrues to the org. Three yield types:
- **L** — Lending protocols (Navi, Scallop, Suilend)
- **Y** — Yield-bearing stablecoins (USDY)
- **S** — Liquid staking tokens / LSTs (stSUI)

Orgs can split across protocols or stay idle; positions coexist on one pool. Claims against a split pool draw liquidity across all positions in one PTB (`cover_claim_from_<protocol>` × N → `claim`); rebalance via `org_withdraw_<protocol>`.

**Claiming.** Claimable amount is computed live: `(effective_end − last_claimed_at − total_paused_ms) × rate_amount / rate_period_ms`. On claim the employee names a target vault + yield routing inline; funds swap and deposit atomically in one PTB.

**Employee vaults.** Multi-token, multiple named vaults per employee, routing across L / Y / S. Each allocation is a percentage + explicit protocol (or `AUTO_MAX_YIELD`, resolved off-chain into an explicit protocol before the tx). Cross-token swaps happen in the same claim PTB.

---

## Contract Architecture

Three core Move packages, each single-responsibility:

```
sweem_core       ← streaming logic + vault primitives (no deps)
sweem_registry   ← governance + protocol approval gate (no deps)
sweem_adapters   ← yield protocol integrations (deps: core + registry)
```

- **`sweem_core`** — `StreamPool`, employee streams, claimable math, pause/stop/resume, `EmployeeVault` / `TokenBucket`. Knows nothing about yield protocols; never changes when a protocol is added.
- **`sweem_registry`** — holds `AdminCap`, `ProtocolRegistry` (approved-protocol list), `ProtocolConfig` (fee rates + treasury). Security gate + fee source: adapters check approval on every call; `core::claim` reads fee rates here at runtime.
- **`sweem_adapters`** — one module per protocol (navi, scallop, suilend, usdy). Deposits/withdraws for a `StreamPool` (org) or `TokenBucket` (employee), gated by `registry::is_approved`.

Two adapters live in their **own packages** because of Move-name / framework-rev collisions with `sweem_adapters`' dep tree: `sweem_adapters_stsui` (AlphaFi stSUI LST, vault-only) and `sweem_adapters_alphalend` (coming soon). The adapter pattern permits this — `registry::is_approved` checks only the protocol *name*, so the registered `adapter_package` address can be any package.

---

## Mainnet Deployment

Chain ID `35834a8a`. Canonical source of truth: [`scripts/deployed.mainnet.json`](./scripts/deployed.mainnet.json). All IDs below are public on-chain data.

### Packages

| Package | Package ID | Notes |
|---|---|---|
| `sweem_registry` | `0x06eae4d4c2c97ab2166f88cc310a4c6f0fc66e2f9583e01ad75c99b2951cfbbd` | v1 |
| `sweem_core` | `0x4c582aea3efe99fb68deea8b71b96eda6fba06001ed5588da83799c09f9179b4` | v1 |
| `sweem_adapters` | `0x25070661b4157bcdfc1ac19df47dcf9472341b222debdc623a85ef383c11da58` | v3 (navi + scallop + suilend + usdy) |
| `sweem_adapters_stsui` | `0x5f5a978fae2e07737e3cac2395ee30092d6c8512a98e18e785c250916d6c2090` | v1 (AlphaFi stSUI, vault-only) |

`sweem_adapters` upgrade history (`original-id` → current):
- v1 navi + scallop — `0x8f0943975ec6f56f97e197713041b192e8ff9b4461c0a496bf129ed37b2866eb` (original-id)
- v2 + suilend — `0x65359daa00855a6049455bde596a508795e5319b208a2555974210414b6efbc7`
- v3 + usdy — `0x25070661b4157bcdfc1ac19df47dcf9472341b222debdc623a85ef383c11da58` (current)

### Shared objects

| Object | ID |
|---|---|
| `AccessControl<REGISTRY>` | `0xf77b660fd90350dd7597e2042142157eeb564eea64b3870276e79d9d36b8cd98` |
| `ProtocolRegistry` | `0xde3026a8847dc89b9b8ce456bf1e316dc60366e8564ac07bc55b50229e146dd8` |
| `ProtocolConfig` | `0x303eb1778420425b1b590452bdaf039e4c6d46431bd502fdad028a305d3d04f1` |
| `Clock` | `0x6` |
| `SuiSystemState` | `0x5` |

### Supported protocols

| Protocol | Yield | Scope | Adapter package · module |
|---|---|---|---|
| Navi | L | pool + vault | `sweem_adapters` · `navi` |
| Scallop | L | pool + vault | `sweem_adapters` · `scallop` |
| Suilend | L | pool + vault | `sweem_adapters` · `suilend` |
| USDY | Y | pool + vault | `sweem_adapters` · `usdy` (thin hold-adapter; USDC↔USDY swap in UI/PTB via Cetus) |
| stSUI | S | vault-only | `sweem_adapters_stsui` · `stsui` (LST — org/pool funds not allowed in LSTs) |
| AlphaLend | L | — | **coming soon** |

Per-protocol object IDs (Navi storage/oracle/incentives, Scallop market, Suilend lending market, stSUI `LiquidStakingInfo`, Cetus pool, coin types, etc.) live in `scripts/deployed.mainnet.json` under `protocols`.

### Coins

- USDC — `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`
- SUI — `0x2::sui::SUI`

---

## Repo Layout

```
contracts/packages-mainnet/   Move packages deployed to mainnet
contracts/packages/           dev/testnet working copies
scripts/                      publish + PTB scripts, deployed.mainnet.json
sweem-sdk/                    TypeScript SDK
sweem-server/                 backend
fe/                           frontend
employee/                     employee app
docs/                         architecture, protocol specs, data model
```

More detail: [`docs/README.md`](./docs/README.md) · contract architecture [`docs/contract/README.md`](./docs/contract/README.md).
