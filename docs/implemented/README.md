# What's Built

Three Move packages form the on-chain protocol. Two environments exist: `contracts/packages/` (testnet, stub adapters) and `contracts/packages-mainnet/` (mainnet, real Navi + Scallop integration).

## Packages

| Package | What it does |
|---|---|
| `sweem_registry` | Admin-controlled protocol allowlist + fee config |
| `sweem_core` | `StreamPool` (org payroll) and `EmployeeVault` (personal yield) |
| `sweem_adapters` | Yield protocol adapters — Navi + Scallop (mainnet), stubs (testnet) |

## Docs

- [sweem_registry.md](sweem_registry.md) — registry design, fee model, admin transfer
- [sweem_core.md](sweem_core.md) — stream pools, employee vaults, yield hooks
- [sweem_adapters.md](sweem_adapters.md) — Navi + Scallop mainnet integration, testnet stubs
- [extensibility.md](extensibility.md) — adding new yield protocols
- [security.md](security.md) — security model
- [testing.md](testing.md) — test coverage summary
