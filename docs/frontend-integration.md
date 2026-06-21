# Frontend + Server Integration — Suilend, stSUI, USDY

Durable implementation guide for wiring the 3 new yield protocols into the apps. Survives session
clears — keep it updated as steps land. Skip `client-test/`.

## Status / context

**App integration: DONE (2026-06-21).** All 5 protocols wired across `fe/` (org payroll
pool L/Y + personal treasury vault L/Y/S), `employee/` (vault L/Y/S), and `sweem-server/`
(live APYs + schemas + AI). All three apps typecheck + `next build` clean. Cetus
USDC↔USDY routing verified live (0.1 USDC → 0.0886 USDY). USDY `--execute` e2e left for a
funded-key run: `scripts/src/e2e-usdy.ts` (`bun run e2e:usdy`, dry-run default).
Key pieces added: `lib/protocols.ts` (descriptor registry), `lib/cetus.ts` (aggregator
swap, `@cetusprotocol/aggregator-sdk@1.6.1` + `axios`), `SlippageInput`, async
`rebalanceTx`/`treasuryInvestTx`/`claimAndAllocateTx` (USDY path only). Live APY sources:
Suilend = on-chain reserve curve, stSUI = `suix_getValidatorsApy`, USDY = DefiLlama
`ondo-yield-assets` (no static fallbacks).

Contracts are **done & live on mainnet** (all e2e-proven; AlphaLend deferred):

| Protocol | Type | Scope | Adapter package | Module |
|---|---|---|---|---|
| navi | L | pool+vault | `sweem_adapters` | `navi` |
| scallop | L | pool+vault | `sweem_adapters` | `scallop` |
| **suilend** | L | pool+vault | `sweem_adapters` | `suilend` |
| **usdy** | Y | pool+vault | `sweem_adapters` | `usdy` |
| **stsui** | S | **vault-only** | `sweem_adapters_stsui` | `stsui` |

Canonical ids: [`scripts/deployed.mainnet.json`](../scripts/deployed.mainnet.json). Move signatures:
`docs/protocols/{suilend,stsui,usdy}.md`.

**Known bug to fix first:** both frontends still point `ADAPTERS` at the stale V1 orphan
`0x8f0943975ec6f56f97e197713041b192e8ff9b4461c0a496bf129ed37b2866eb`. Bump to the current package.

### Scope rule (enforce in UI)
- **Org payroll pool** → **L/Y only**: navi, scallop, suilend, usdy. **Never stSUI** (LST).
- **Vaults** (employee app + `fe/` treasury-panel, which is a personal vault) → **L/Y/S**: all five
  incl. stSUI. (Contract enforces it too: stSUI exposes no `pool_*` functions.)

## Canonical ids

```
CORE              0x4c582aea3efe99fb68deea8b71b96eda6fba06001ed5588da83799c09f9179b4
ADAPTERS          0x25070661b4157bcdfc1ac19df47dcf9472341b222debdc623a85ef383c11da58   (navi,scallop,suilend,usdy)
ADAPTERS_STSUI    0x5f5a978fae2e07737e3cac2395ee30092d6c8512a98e18e785c250916d6c2090
PROTOCOL_REGISTRY 0xde3026a8847dc89b9b8ce456bf1e316dc60366e8564ac07bc55b50229e146dd8
PROTOCOL_CONFIG   0x303eb1778420425b1b590452bdaf039e4c6d46431bd502fdad028a305d3d04f1
CLOCK             0x6
SUILEND_LENDING_MARKET  0x84030d26d85eaa7035084a057f2f11f701b7e2e4eda87551becbc7c97505ece1
STSUI_LST_INFO          0x1adb343ab351458e151bc392fbf1558b3332467f23bda45ae67cd355a57fd5f5
STSUI_SYSTEM_STATE      0x5
USDY_TYPE         0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY
USDY_CETUS_POOL   0x0e809689d04d87f4bd4e660cd1b84bf5448c5a7997e3d22fc480e7e5e0b3f58d   (Pool<USDY, wormholeUSDC>)
WORMHOLE_USDC     0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN
```

## Verified move signatures (source of truth — not exploration-agent templates)

**suilend** — generic `<T>`; lending market resolves the reserve on-chain (no pkg/reserve args):
```
pool_invest_suilend<T>(pool, lendingMarket, registry, clock, amount)
org_withdraw_suilend<T>(pool, lendingMarket, config, registry, clock, amount)
cover_claim_from_suilend<T>(pool, lendingMarket, config, registry, clock, maxAmount)
vault_invest_suilend<T>(vault, tokenName, lendingMarket, registry, clock, amount)
vault_withdraw_suilend<T>(vault, tokenName, lendingMarket, config, registry, clock)   // full, no amount
```
**stsui** — NON-generic, SUI only, VAULT-ONLY, target `${ADAPTERS_STSUI}::stsui::*`:
```
vault_invest_stsui(vault, tokenName, lstInfo, systemState, registry, amount)
vault_withdraw_stsui(vault, tokenName, lstInfo, systemState, config, registry)        // full
```
**usdy** — 2-step hot-potato; generic; pool + vault; `${ADAPTERS}::usdy::*`:
```
pool_invest_usdy_extract<T>(pool, registry, amount)            -> (Coin<T>, UsdyInvestReceipt)
pool_invest_usdy_deposit<T,Y>(pool, registry, yieldedCoin, receipt)
pool_withdraw_usdy_extract<T,Y>(pool, registry, amountY)       -> (Coin<Y>, UsdyWithdrawReceipt)
pool_withdraw_usdy_deposit<T>(pool, config, registry, recoveredCoin, receipt)
vault_invest_usdy_extract<T>(vault, tokenName, registry, amount)            -> (Coin<T>, receipt)
vault_invest_usdy_deposit<T,Y>(vault, tokenName, registry, yieldedCoin, receipt)
vault_withdraw_usdy_extract<T,Y>(vault, tokenName, registry, amountY)       -> (Coin<Y>, receipt)
vault_withdraw_usdy_deposit<T>(vault, tokenName, config, registry, recoveredCoin, receipt)
```
Receipt = no-abilities hot potato: its result flows directly from `*_extract` to `*_deposit` in the
same `Transaction`; the Cetus swap sits between them consuming the `Coin<T>` / `Coin<Y>`.

---

## Step 2 — ids/config (mirror `fe/lib/sweem.ts` + `employee/src/lib/sweem.ts`)
- Fix `ADAPTERS = '0x25070661…da58'`.
- Add `ADAPTERS_STSUI`, `SUILEND_LENDING_MARKET`, `STSUI_LST_INFO`, `STSUI_SYSTEM_STATE`, `USDY_TYPE`,
  `USDY_CETUS_POOL`, `WORMHOLE_USDC`.
- `lib/tokens.ts`: extend `TokenConfig` with optional `suilend?: { minInvest }` and `usdy?: { minInvest }`
  (small UI floor, e.g. 0.1 USDC — no on-chain min). stSUI is SUI-fixed, no per-token entry.

## Step 3 — tx builders (mirror `fe/lib/tx.ts` + `employee/src/lib/tx.ts`)

### suilend pool (org, fe)
```ts
function appendPoolInvestSuilend(tx, poolId, amountRaw, token) {
  tx.moveCall({ target: `${ADAPTERS}::suilend::pool_invest_suilend`, typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(amountRaw)] })
}
function appendOrgWithdrawSuilend(tx, poolId, amountRaw, token) {
  tx.moveCall({ target: `${ADAPTERS}::suilend::org_withdraw_suilend`, typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_CONFIG), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(amountRaw)] })
}
function appendCoverSuilend(tx, poolId, maxAmountRaw, token) {   // before stream_pool::claim
  tx.moveCall({ target: `${ADAPTERS}::suilend::cover_claim_from_suilend`, typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_CONFIG), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(maxAmountRaw)] })
}
```
### suilend vault (both apps)
```ts
export function vaultInvestSuilendTx(vaultId, amountRaw, token = TOKENS.USDC) {
  const tx = new Transaction()
  tx.moveCall({ target: `${ADAPTERS}::suilend::vault_invest_suilend`, typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK), tx.pure.u64(amountRaw)] })
  return tx
}
export function vaultWithdrawSuilendTx(vaultId, token = TOKENS.USDC) {   // full position
  const tx = new Transaction()
  tx.moveCall({ target: `${ADAPTERS}::suilend::vault_withdraw_suilend`, typeArguments: [token.coinType],
    arguments: [tx.object(vaultId), tx.pure.string(token.bucketName), tx.object(SUILEND_LENDING_MARKET), tx.object(PROTOCOL_CONFIG), tx.object(PROTOCOL_REGISTRY), tx.object(CLOCK)] })
  return tx
}
```
### stSUI vault-only (SUI, non-generic, ADAPTERS_STSUI)
```ts
export function vaultInvestStsuiTx(vaultId, amountRaw) {
  const tx = new Transaction()
  tx.moveCall({ target: `${ADAPTERS_STSUI}::stsui::vault_invest_stsui`,   // NO typeArguments
    arguments: [tx.object(vaultId), tx.pure.string('SUI'), tx.object(STSUI_LST_INFO), tx.object(STSUI_SYSTEM_STATE), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountRaw)] })
  return tx
}
export function vaultWithdrawStsuiTx(vaultId) {   // full position
  const tx = new Transaction()
  tx.moveCall({ target: `${ADAPTERS_STSUI}::stsui::vault_withdraw_stsui`,
    arguments: [tx.object(vaultId), tx.pure.string('SUI'), tx.object(STSUI_LST_INFO), tx.object(STSUI_SYSTEM_STATE), tx.object(PROTOCOL_CONFIG), tx.object(PROTOCOL_REGISTRY)] })
  return tx
}
```
### USDY 2-step + Cetus swap (pool + vault)
```ts
export async function poolInvestUsdyTx({ poolId, amountRaw, token, slippageBps }) {
  const tx = new Transaction()
  const [usdcCoin, receipt] = tx.moveCall({ target: `${ADAPTERS}::usdy::pool_invest_usdy_extract`, typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountRaw)] })
  const usdyCoin = await appendCetusSwap(tx, { inputCoin: usdcCoin, fromType: token.coinType, toType: USDY_TYPE, amountIn: amountRaw, slippageBps })
  tx.moveCall({ target: `${ADAPTERS}::usdy::pool_invest_usdy_deposit`, typeArguments: [token.coinType, USDY_TYPE],
    arguments: [tx.object(poolId), tx.object(PROTOCOL_REGISTRY), usdyCoin, receipt] })
  return tx
}
export async function poolWithdrawUsdyTx({ poolId, amountYRaw, token, slippageBps }) {
  const tx = new Transaction()
  const [usdyCoin, receipt] = tx.moveCall({ target: `${ADAPTERS}::usdy::pool_withdraw_usdy_extract`, typeArguments: [token.coinType, USDY_TYPE],
    arguments: [tx.object(poolId), tx.object(PROTOCOL_REGISTRY), tx.pure.u64(amountYRaw)] })
  const usdcCoin = await appendCetusSwap(tx, { inputCoin: usdyCoin, fromType: USDY_TYPE, toType: token.coinType, amountIn: amountYRaw, slippageBps })
  tx.moveCall({ target: `${ADAPTERS}::usdy::pool_withdraw_usdy_deposit`, typeArguments: [token.coinType],
    arguments: [tx.object(poolId), tx.object(PROTOCOL_CONFIG), tx.object(PROTOCOL_REGISTRY), usdcCoin, receipt] })
  return tx
}
// VAULT variants: same shape; first arg tx.object(vaultId) + tx.pure.string(token.bucketName);
//   targets vault_invest_usdy_extract/deposit + vault_withdraw_usdy_extract/deposit;
//   the withdraw deposit still takes PROTOCOL_CONFIG.
```
### type unions + combinators
- `PoolBucket = 'idle'|'navi'|'scallop'|'suilend'|'usdy'`  (NO stsui).
- `YieldProtocol = 'navi'|'scallop'|'suilend'|'usdy'|'stsui'`.
- `rebalanceTx`: add suilend branches; usdy path is async (Cetus) — make the usdy rebalance its own
  async builder or make rebalance async.
- `treasuryInvestTx` / `claimAndAllocateTx`: add suilend + stsui + usdy legs mirroring navi/scallop.
  The usdy leg needs the 2-step+swap (async) — may require a separate builder rather than inlining.

## Step 4 — Cetus swap helper (`fe/lib/cetus.ts` + `employee/src/lib/cetus.ts`)
Add `@cetusprotocol/aggregator-sdk` to both apps.
```ts
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk'
// appends swap moveCalls onto `tx`, consumes inputCoin, returns the output coin argument
export async function appendCetusSwap(tx, { inputCoin, fromType, toType, amountIn, slippageBps }) {
  const client = new AggregatorClient(/* mainnet endpoint + suiClient */)
  const route = await client.findRouters({ from: fromType, target: toType, amount: BigInt(amountIn), byAmountIn: true })
  if (!route) throw new Error('no Cetus route')
  return await client.routerSwap({ routers: route, txb: tx, inputCoin, slippage: slippageBps / 10_000 })
}
```
Confirm the exact aggregator API (`findRouters` / `routerSwap` names, whether it accepts an existing
txb + input coin) against the installed SDK version. USDC↔USDY is multi-hop (native↔wormhole-USDC↔USDY);
let the aggregator route it. **Thin pool → keep amounts small, always enforce the quoted min_out.**

## Step 5 — UI
- **Org** `fe/components/dashboard/sweem/payroll-screen.tsx`: suilend + usdy `ProtocolRow`s (state,
  validation, `handleConfirmInvest` branches) + add to rebalance `BUCKETS`/picker. **No stsui.**
- **Vaults** `fe/.../treasury-panel.tsx` (personal vault, L/Y/S) +
  `employee/src/components/dashboard/sweem/{employee-portal-screen,ui}.tsx`: render protocols from a
  `scope`-filtered list (vault shows navi/scallop/suilend/usdy/**stsui**); wire each leg in invest +
  claim-allocate modals.
- **Logos** `components/sweem-ui/protocol-logo.tsx` (both): add `suilend:'/protocols/lending/suilend.png'`,
  `stsui:'/protocols/lending/alphafi.png'`, `usdy:'/coins/usdy.svg'`. fe/ already has these; **copy**
  `suilend.png` + `alphafi.png` → `employee/public/protocols/lending/` and `usdy.svg` →
  `employee/public/coins/`.

## Step 6 — Server (`sweem-server/`)
- `src/schemas/pools.schema.ts`: add `'SUILEND'`.
- `src/schemas/vaults.schema.ts`: add `'SUILEND'` + `'STSUI'`.
- `src/lib/yield.ts`: add `fetchSuilendApy`, `fetchStsuiApy`, `fetchUsdyApy`; include in `getYields` +
  `resolveMaxYield` (`src/controllers/compute.controllers.ts`). Sources: Suilend on-chain ctoken rate /
  SDK; stSUI share-price growth (AlphaFi); USDY ≈ Ondo APY (~4-5%) or pool-implied. Frontends map the
  new enum values (`SUILEND`/`STSUI`/`USDY`) in their APY lookups.
- `src/controllers/ai.controllers.ts` `getProtocolInfo`: list all 5 protocols + L/Y/S.

## Verification
- Build/typecheck clean: `fe/`, `employee/`, `sweem-server/`.
- Org: invest pool → suilend + usdy → rebalance → withdraw; stSUI absent from org UI.
- Vault: claim → allocate navi/scallop/suilend/stsui/usdy; invest + withdraw each.
- USDY: builder produces extract→Cetus-swap→deposit in ONE PTB; dry-run then tiny `--execute`;
  assert realized out ≥ min_out.
- APY picker shows live numbers for all 5; `/v1/compute/yields` returns the new quotes.

## Reference: proven contract e2e digests (mainnet)
- suilend invest `652L6MDC…`, withdraw `CUtCHBxo…`
- stSUI stake `Hmppa4Rz…`, unstake `8hHaderY…`
- usdy invest `2Wo4ym4B…`, withdraw `GWT6TTu6…` (Y=USDC test)
- adapters upgrade (usdy) `C2x1rtix…`; registrations: suilend `CQwxwLhZ…`, stsui `Gt2rSjGu…`, usdy `9TxBh3Py…`
