# sweem_registry

`contracts/packages-mainnet/sweem_registry/sources/registry.move`

## Purpose

Central on-chain config that controls which yield protocols `sweem_adapters` can route funds to, and what fees Sweem charges.

## Shared Objects

**`AccessControl<REGISTRY>`** — OZ shared access control object. Manages role assignments. Created in `init`, grants `FeeManagerRole` and `ProtocolManagerRole` to the deployer.

**`ProtocolRegistry`** — a VecMap of `name → ProtocolEntry`. Any adapter function checks `is_approved(registry, &name)` before touching external protocols. Protocols can be toggled enabled/disabled without being removed.

**`ProtocolConfig`** — holds fee rates and the treasury address where fees are sent.

## RBAC Model

Registry access uses OpenZeppelin `AccessControl<REGISTRY>`. Replaces the hand-rolled `AdminCap` pattern.

| Role | Functions it gates |
|---|---|
| `FeeManagerRole` | `set_fees`, `set_treasury` |
| `ProtocolManagerRole` | `add_protocol`, `enable_protocol`, `disable_protocol` |

All role structs are defined in the same `registry` module as the OTW (`REGISTRY`) — required by OZ to avoid `EForeignRole`.

### Calling admin functions

Pass `(&ac, ctx)` instead of the old `(&cap)`:

```move
registry::add_protocol(&mut reg, &ac, name, pkg_addr, yield_type, ctx);
registry::set_fees(&mut config, &ac, deposit_fee_bps, org_fee, vault_fee, ctx);
```

`ac` is a shared `AccessControl<REGISTRY>` — take it with `scenario.take_shared<AccessControl<REGISTRY>>()` in tests.

### Admin transfer

OZ's built-in `begin_default_admin_transfer` / `accept_default_admin_transfer` with configurable delay replaces the old `propose_admin_transfer` / `accept_and_keep` pattern.

## Fee Model

All fees are in basis points (bps). 10,000 bps = 100%.

| Fee | Cap | Applies to |
|---|---|---|
| `deposit_fee_bps` | 5% | Charged on deposit into a StreamPool |
| `org_yield_fee_bps` | 50% | Cut of yield earned on unclaimed pool funds |
| `vault_yield_fee_bps` | 50% | Cut of yield earned in employee vaults |

Fees start at 0 after deploy. Set them with `set_fees(config, &ac, ..., ctx)`.

## Protocol Entry Fields

```
adapter_package: address   // which package handles this protocol
yield_type: u8             // 0 = Lending, 1 = Yield-bearing stablecoin, 2 = LST
enabled: bool
```

## Events

`ProtocolAdded`, `ProtocolDisabled`, `ProtocolEnabled`, `FeesUpdated`, `TreasuryUpdated`

OZ emits its own events for admin transfer and role grants/revokes.
