# AlphaFi stSUI adapter (yield_type S = 2)

Liquid-staking yield adapter. Stakes SUI into AlphaFi's stSUI LST and unstakes back to
SUI. **Vault-only** and lives in its **own package** — both are deliberate. See rationale
below.

## Package

| | |
|---|---|
| New package | `contracts/packages-mainnet/sweem_adapters_stsui` |
| Module | `sweem_adapters_stsui::stsui` |
| Protocol name (registry) | `stsui` |
| `yield_type` | `2` (S / LST) |
| Underlying `T` | SUI = `0x2::sui::SUI` |
| Receipt coin `Coin<P>` | stSUI = `Coin<STSUI>` |

## On-chain ids (mainnet)

| Object / type | Id |
|---|---|
| stSUI coin type / witness `P` | `0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI` |
| `liquid_staking` package (original / first publish, defines the type) | `0xc35ee7fee75782806890cf8ed8536b52b4ba0ace0fb46b944f1155cc5945baa3` |
| `liquid_staking` published-at (latest, what `mint`/`redeem` dispatch to) | `0x059f94b85c07eb74d2847f8255d8cc0a67c9a8dcc039eabf9f8b9e23a0de2700` |
| `LiquidStakingInfo<STSUI>` shared object | `0x1adb343ab351458e151bc392fbf1558b3332467f23bda45ae67cd355a57fd5f5` |
| `SuiSystemState` (system object) | `0x5` |

`LiquidStakingInfo<STSUI>` verified on mainnet (read-only):
- `objType = 0xc35ee7…baa3::liquid_staking::LiquidStakingInfo<0xd1b72982…e55::stsui::STSUI>`
- owner = `Shared` (initial_shared_version 443441850)

Source: AlphaFi `@alphafi/stsui-sdk` `production` config (`common/ids.js`) + on-chain
`sui client object`. The stSUI coin type from the SDK matches the verified witness exactly.

## AlphaFi dependency (pinned)

Repo `https://github.com/AlphaFiTech/liquid-staking.git`, rev
`f65b1bb8685bc07559d7aca9f48d876f3de75034`:
- subdir `contracts` → Move package name `liquid_staking` (mint/redeem + `LiquidStakingInfo<P>`)
- subdir `stsui` → Move package name `stsui` (the `STSUI` coin witness)

Both carry edition `2024.beta`; this adapter package is edition `2024`. Deps keep their own edition.

## Verified signatures (from `contracts/sources/liquid_staking.move`)

```move
module liquid_staking::liquid_staking;

// stake SUI -> stSUI (line 320). No Clock; refreshes internally vs system_state.
public fun mint<P: drop>(
    self: &mut LiquidStakingInfo<P>,
    system_state: &mut SuiSystemState,
    sui: Coin<SUI>,
    ctx: &mut TxContext,
): Coin<P>

// unstake stSUI -> SUI (line 365). Instant (no unbonding). Note arg order:
// lst comes BEFORE system_state.
public fun redeem<P: drop>(
    self: &mut LiquidStakingInfo<P>,
    lst: Coin<P>,
    system_state: &mut SuiSystemState,
    ctx: &mut TxContext,
): Coin<SUI>
```

AlphaFi charges its own mint and redeem fees internally (deducted inside `mint`/`redeem`).

## Adapter API (vault-only)

```move
public fun vault_invest_stsui(
    vault: &mut EmployeeVault,
    token_name: String,
    lst_info: &mut LiquidStakingInfo<STSUI>,
    system_state: &mut SuiSystemState,
    registry: &ProtocolRegistry,
    amount: u64,
    ctx: &mut TxContext,
)

public fun vault_withdraw_stsui(
    vault: &mut EmployeeVault,
    token_name: String,
    lst_info: &mut LiquidStakingInfo<STSUI>,
    system_state: &mut SuiSystemState,
    config: &ProtocolConfig,
    registry: &ProtocolRegistry,
    ctx: &mut TxContext,
)
```

- `token_name` bucket coin type is fixed to `SUI` (LSTs are SUI-native).
- Both gate on `is_approved(registry, "stsui")` first, then `owner(vault) == sender`.
- `vault_withdraw_stsui` is full-position (no partial amount), mirroring `vault_withdraw_scallop`.

### Storage

- `Coin<STSUI>` (key+store) → DOF under `StsuiVaultLstKey()` on the bucket UID.
- `StsuiPosition { deposited_value: u64 }` (store-only, the SUI principal) → DF under
  `StsuiVaultPositionKey()` on the bucket UID.

Keys are unique to this module, so an stSUI position coexists with any L/Y positions on
the same bucket without collision.

## Yield model — share-price growth

stSUI is a share token; its SUI redemption value grows as staking rewards accrue. We record
the SUI principal staked (`deposited_value`) at invest time. On withdraw:

```
gross           = SUI returned by redeem<STSUI>(...)   // net of AlphaFi's redeem fee
yield_earned    = max(gross - deposited_value, 0)
fee             = floor(yield_earned * vault_yield_fee_bps / 10_000)   // -> treasury
net             = gross - fee                                          // -> bucket
```

`yield_earned` is 0 when AlphaFi's mint+redeem fees exceed accrued rewards over a short hold,
so no fee is charged in that case. Fee math is the pure, unit-tested `compute_yield_fee`.

## Two structural decisions (rationale)

### 1. Vault-only

Org/pool payroll funds must NEVER enter an LST. This package exposes ONLY the two
employee-vault functions. The **absence** of `pool_invest_*`, `pool_withdraw_*`,
`cover_claim_from_*`, and `org_withdraw_*` is the enforcement: there is simply no code path
that can move org/pool money into stSUI. Org payroll money stays in L / Y strategies only.

### 2. Separate package

AlphaFi's `liquid_staking` Move package **name-collides** with Suilend's `liquid_staking`
dependency already pulled into `sweem_adapters`. They are different on-chain packages sharing
one Move name → cannot coexist in a single build tree. So this adapter is a brand-new package
that depends on AlphaFi (NOT Suilend), keeping the dependency trees apart. The adapter pattern
permits this: `registry::is_approved` only checks the protocol NAME, and the registered
`adapter_package` address can be any package (it is stored for off-chain reference, not
enforced on-chain).

## Build / test

```
cd contracts/packages-mainnet/sweem_adapters_stsui
sui move build   # clean
sui move test    # 6 passing: fee math (4), approval gate, owner gate
```

Move.toml notes:
- `sui_system = { system = "sui_system", override = true }` — modern system-dependency syntax
  exposes the `sui_system` address (for `SuiSystemState`); `override` resolves AlphaFi pinning
  a different framework rev of the same on-chain system package (0x3).
- `openzeppelin_access` declared directly (transitive via `sweem_registry`) so tests can name
  `AccessControl` when exercising the approval gate.

Unit tests cannot exercise the live `mint`/`redeem` calls (the shared `LiquidStakingInfo` and
`SuiSystemState` cannot be constructed in a unit test), so coverage is: pure yield-fee math,
the registry approval gate, and the owner-only gate. Full invest→withdraw is validated by the
mainnet e2e (real SUI), not a unit test.

## Testnet stub

Skipped on purpose — this adapter is validated directly on mainnet with real SUI (AlphaFi
stSUI has no equivalent testnet deployment wired into the Sweem test flow).
