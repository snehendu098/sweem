# Testing

## Test coverage

Tests live in `contracts/packages-mainnet/` (mainnet versions are the canonical ones).

| File | Tests |
|---|---|
| `sweem_core/tests/stream_pool_tests.move` | 9 |
| `sweem_registry/tests/registry_tests.move` | 7 |
| `sweem_core/tests/employee_vault_tests.move` | 4 |
| **Total** | **20** |

`sweem_adapters` has no unit tests — adapters are thin wrappers around external protocols. Integration testing requires live objects from those protocols.

## Running tests

```sh
cd contracts/packages-mainnet/sweem_core
sui move test

cd contracts/packages-mainnet/sweem_registry
sui move test
```

## What's covered

**stream_pool_tests**: deposit with fee, stream creation, claimable calculation, pause/resume, stop, topup, claim, min claim enforcement

**registry_tests**: add protocol, disable/enable, fee validation (caps enforced), treasury update, admin transfer (propose + accept), `is_approved` and `protocols_by_type` queries

**employee_vault_tests**: create vault, init bucket, deposit, withdraw, owner-only enforcement

## What's not covered

**Navi adapter** — requires live `Storage`, `Pool<T>`, `IncentiveV2`, `IncentiveV3`, and `PriceOracle` shared objects. Cannot be unit tested without a full Navi deployment.

**Scallop adapter** — requires live `Version` and `Market` shared objects. Same constraint.

**`claim_with_liquidity` / `claim_with_liquidity_scallop`** — requires both pool state and live protocol objects together. Integration tested via testnet stubs.

**Multi-protocol scenarios** — no test for a pool with both Navi and Scallop positions.

## Testnet strategy

Both testnet stub packages (`contracts/packages/sweem_adapters/`) have matching public APIs but no external protocol dependencies. They allow full flow testing on testnet:

```
create pool → deposit → streams → claim → vault invest → vault withdraw
```

For both Navi and Scallop. State tracking (DF positions, events) behaves identically to mainnet — only the actual DeFi protocol calls are stubbed.

**Testing with real protocols on testnet:**

- **Navi**: deploy against Navi's live testnet deployment (see `docs/protocols/navi.md` for testnet object IDs)
- **Scallop**: check whether a Scallop testnet deployment exists; if not, use the stub adapter
