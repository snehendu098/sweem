# sweem_registry

Governance package. Holds the `AccessControl<REGISTRY>`, the `ProtocolRegistry` shared object, and the `ProtocolConfig` shared object.

This package has three responsibilities:
- **Authorization gate** — every adapter function checks `is_approved` before routing funds
- **Protocol directory** — frontend reads approved protocols to build UI and resolve `AUTO_MAX_YIELD`
- **Fee configuration** — stores stream fee and vault yield fee rates, read by `sweem_core` and `sweem_adapters` at runtime

Has no dependencies on `sweem_core` or `sweem_adapters`.

---

## What this package does NOT do

It does not know how to deposit into Scallop or withdraw from Navi. It cannot move a single token. That is `sweem_adapters`'s job. The registry stores names, flags, and fee config only.

---

## Dependencies

```
sweem_registry → openzeppelin_access
```

---

## RBAC Model

Access control uses OpenZeppelin's `AccessControl<RootRole>` pattern (OTW-based).

### Roles

| Role | Gates |
|---|---|
| Default admin (root) | `grant_role`, `begin_default_admin_transfer`, timelock-protected rotation |
| `FeeManagerRole` | `set_fees`, `set_treasury` |
| `ProtocolManagerRole` | `add_protocol`, `enable_protocol`, `disable_protocol` |

All role types (`REGISTRY`, `FeeManagerRole`, `ProtocolManagerRole`) are defined in the same `registry` module to satisfy OZ's `EForeignRole` check.

### Granting and revoking roles

`AccessControl<REGISTRY>` is a shared object. Role management goes through OZ's API:

```move
// Grant a role (default admin only)
access_control::grant_role<REGISTRY, FeeManagerRole>(&mut ac, target_address, ctx);

// Revoke a role (default admin only)
access_control::revoke_role<REGISTRY, FeeManagerRole>(&mut ac, target_address, ctx);

// Check a role inside module functions
access_control::assert_has_role<REGISTRY, FeeManagerRole>(ac, ctx.sender());
```

### Admin transfer

Built into OZ `AccessControl` via `begin_default_admin_transfer` / `accept_default_admin_transfer` with configurable delay. This replaces the hand-rolled `PendingAdminTransfer` pattern from the previous `AdminCap` design.

---

## Storage

### `AccessControl<REGISTRY>` — Shared Object

OZ shared access control object. Stores role assignments internally. Created in `init`, granted both `FeeManagerRole` and `ProtocolManagerRole` to deployer immediately.

Required to call:
- `add_protocol`, `disable_protocol`, `enable_protocol` (need `ProtocolManagerRole`)
- `set_fees`, `set_treasury` (need `FeeManagerRole`)

---

### `ProtocolRegistry` — Shared Object

```
id:        UID
protocols: VecMap<String, ProtocolEntry>   ← keyed by protocol name e.g. "navi"
```

Shared so adapter functions and the frontend can read it without owning it.

---

### `ProtocolEntry` — stored inside `ProtocolRegistry.protocols`

```
adapter_package: address   ← on-chain package ID of the adapter that handles this protocol
yield_type:      u8        ← 0 = L (Lending), 1 = Y (Yield stablecoin), 2 = S (LST)
enabled:         bool      ← false = soft-disabled, not deleted
```

Soft-disable is used instead of deletion — deleting would break withdrawal flows for existing yield positions that still reference the protocol name.

---

### `ProtocolConfig` — Shared Object

Holds all fee parameters. Read by `sweem_core::deposit`/`topup` and by every `sweem_adapters` yield withdrawal function.

```
id:                  UID
deposit_fee_bps:     u64      ← basis points on org deposits and topups (e.g. 25 = 0.25%)
org_yield_fee_bps:   u64      ← basis points on yield earned in StreamPool positions (e.g. 1000 = 10%)
vault_yield_fee_bps: u64      ← basis points on yield earned in EmployeeVault positions (e.g. 1000 = 10%)
treasury:            address  ← address that receives all collected fees
```

**Why these three fee types:**
- `deposit_fee_bps` — charged to the org at deposit/topup time. Org pays for using the service upfront. Employees receive their full salary with no deductions at claim time.
- `org_yield_fee_bps` — charged to the org when yield positions are unwound. Sweem takes a cut of yield earned on idle payroll funds. The remaining yield still extends the pool runway.
- `vault_yield_fee_bps` — charged to the employee on yield earned inside `EmployeeVault` positions only. Employee principal is never touched — full salary always received.

---

## Module: `registry` — Functions

### `init`
```
fun init(otw: REGISTRY, ctx: &mut TxContext)
```
Called once at package deployment.

**Algo:**
1. Create `AccessControl<REGISTRY>` via OZ `access_control::new(otw, 0, ctx)`
2. Grant `FeeManagerRole` and `ProtocolManagerRole` to `ctx.sender()`
3. Share the `AccessControl` object
4. Create `ProtocolRegistry` with empty VecMap, share it
5. Create `ProtocolConfig { ..., treasury: ctx.sender() }` with all fees at 0, share it

---

### `add_protocol`
```
public fun add_protocol(
    registry:        &mut ProtocolRegistry,
    ac:              &AccessControl<REGISTRY>,
    name:            String,
    adapter_package: address,
    yield_type:      u8,
    ctx:             &TxContext,
)
```
**Algo:**
1. Assert caller has `ProtocolManagerRole`
2. Assert name not already in registry
3. Assert `yield_type <= 2`
4. Insert `ProtocolEntry { adapter_package, yield_type, enabled: true }`
5. Emit `ProtocolAdded` event

---

### `disable_protocol` / `enable_protocol`
Both require `ProtocolManagerRole`. Toggle `entry.enabled`. Does not delete — existing positions can still be withdrawn.

---

### `set_fees`
```
public fun set_fees(
    config:              &mut ProtocolConfig,
    ac:                  &AccessControl<REGISTRY>,
    deposit_fee_bps:     u64,
    org_yield_fee_bps:   u64,
    vault_yield_fee_bps: u64,
    ctx:                 &TxContext,
)
```
Requires `FeeManagerRole`. Hard caps: deposit ≤ 5%, yield fees ≤ 50%.

---

### `set_treasury`
Requires `FeeManagerRole`. Updates fee recipient address.

---

## Module: `registry` — read-only helpers

### `is_approved`
```
public fun is_approved(registry: &ProtocolRegistry, name: &String): bool
```
Called by every adapter function before routing any funds.

---

### `protocols_by_type`
```
public fun protocols_by_type(registry: &ProtocolRegistry, yield_type: u8): vector<String>
```
Returns all enabled protocol names for a given type (0=L, 1=Y, 2=S).

---

## Errors

```
EProtocolAlreadyExists
EProtocolNotFound
EInvalidYieldType
EDepositFeeTooHigh
EOrgYieldFeeTooHigh
EVaultYieldFeeTooHigh
```

OZ access control errors (`EUnauthorized`, `ENotDefaultAdmin`, etc.) are surfaced from the `openzeppelin_access` package directly.

---

## Events

```
ProtocolAdded:   { name: String, adapter_package: address, yield_type: u8 }
ProtocolDisabled: { name: String }
ProtocolEnabled:  { name: String }
FeesUpdated:      { deposit_fee_bps: u64, org_yield_fee_bps: u64, vault_yield_fee_bps: u64 }
TreasuryUpdated:  { new_treasury: address }
```

Admin transfer events are emitted by the `openzeppelin_access` package.

---

## Lifecycle: adding a new protocol

```
1. Research protocol → write docs/protocols/<name>.md
2. Write sweem_adapters::<name> module
3. Upgrade sweem_adapters (additive)
4. Call add_protocol(registry, &ac, "<name>", pkg_address, yield_type, ctx)
5. Frontend reads protocols_by_type → appears automatically
```

`sweem_core` is never touched.

---

## Upgrade strategy

`ProtocolRegistry` and `ProtocolConfig` are data-level — adding protocols and updating fees never requires a package upgrade. The package only needs upgrading if the governance model itself changes.

Upgrade policy: **Compatible**. UpgradeCap held by multisig with 48h timelock.
