# ref-client-test — Sweem demo reference (port target: main frontend `fe/`)

This is the implementation reference for the Sweem streaming-payroll demo built in `client-test`.
It documents the **deployed IDs**, the **backend API**, the **on-chain Move functions**, the
**client lib** (`sweem.ts` / `tx.ts` / `api.ts`), and the two **flows** (org + employee). Use it to
re-implement the same behavior in the production frontend (`fe/`). Everything is **mainnet**.

---

## 1. Architecture

- **Contracts** (Sui mainnet): `sweem_registry` (admin allowlist + fees), `sweem_core`
  (`StreamPool` org payroll + `EmployeeVault` personal yield), `sweem_adapters` (Navi + Scallop).
- **One `StreamPool<USDC>` per org** streams to ALL its employees (off-chain "groups" are just labels).
- **Backend** (`sweem-server`, Cloudflare Worker + Neon Postgres): a metadata **indexer** only
  (org/group/employee/pool/vault rows, live APRs). **Not** a source of truth — the employee side
  reconstructs everything from chain so it works even if the backend is down.
- **Wallet**: `@mysten/dapp-kit`; tx signing via `useSignAndExecuteTransaction` + `client.waitForTransaction`.

---

## 2. Deployed IDs / constants (`src/lib/sweem.ts`)

| Const | Value |
|---|---|
| `CORE` (sweem_core pkg) | `0x4c582aea3efe99fb68deea8b71b96eda6fba06001ed5588da83799c09f9179b4` |
| `ADAPTERS` (sweem_adapters pkg) | `0x8f0943975ec6f56f97e197713041b192e8ff9b4461c0a496bf129ed37b2866eb` |
| registry pkg | `0x06eae4d4c2c97ab2166f88cc310a4c6f0fc66e2f9583e01ad75c99b2951cfbbd` |
| `PROTOCOL_CONFIG` (shared) | `0x303eb1778420425b1b590452bdaf039e4c6d46431bd502fdad028a305d3d04f1` |
| `PROTOCOL_REGISTRY` (shared) | `0xde3026a8847dc89b9b8ce456bf1e316dc60366e8564ac07bc55b50229e146dd8` |
| AccessControl<REGISTRY> (shared) | `0xf77b660fd90350dd7597e2042142157eeb564eea64b3870276e79d9d36b8cd98` |
| `USDC` (6 dp) | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| `CLOCK` | `0x6` |
| `NAVI_LENDING_CORE_PKG` (latest, for `lending::create_account`) | `0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb` |
| `NAVI_STORAGE` | `0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe` |
| `NAVI_PRICE_ORACLE` | `0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef` |
| `NAVI_INCENTIVE_V2` | `0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c` |
| `NAVI_INCENTIVE_V3` | `0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80` |
| `NAVI_POOL_USDC` (`Pool<USDC>`) | `0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8` |
| `NAVI_ASSET_ID` | `10` |
| `SCALLOP_VERSION` | `0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7` |
| `SCALLOP_MARKET` | `0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9` |
| `NAVI_MIN_INVEST_USDC` | `5` |
| `WEEK_MS` / `MONTH_MS` | `604_800_000` / `2_592_000_000` (rate period) |
| `API_BASE` | `https://sweem-server-mainnet.silonelabs.workers.dev` |

**Helpers:** `toRaw(usdc)→bigint`, `fromRaw(raw)→number` (6 dp), `minClaimRaw(rateRaw, periodMs)`
(= 10% of one week's earnings; the claim floor), `weeklyCommitRaw(rateRaw, periodMs)`
(= one stream's weekly commitment; Σ = coverage floor). `EXPLORER_TX/OBJ(id)`.

---

## 3. Backend API (`sweem-server`, base = `API_BASE`)

Writes need wallet personal-message auth headers `X-Wallet-Address / X-Signature / X-Message`
where message = `sweem:<rand>:<rand>:<unixSeconds>` (TTL 60s). `409` on create = already exists (ok).
**Reads are public.** Numeric columns serialize as **strings** (coerce with `Number()`).

| Method | Path | Body / returns |
|---|---|---|
| POST | `/v1/orgs` | `{name}` → org `{wallet,name}` (auth) |
| GET | `/v1/orgs/:wallet` | org or 404 |
| POST | `/v1/orgs/:wallet/groups` | `{name}` → `{id,orgWallet,name}` (auth) |
| GET | `/v1/orgs/:wallet/groups` | `[group]` |
| POST | `/v1/orgs/:wallet/employees` | `{alias, wallet_address, group_id?, rates:[{token,rate_amount,rate_type}]}` (auth) |
| GET | `/v1/orgs/:wallet/employees` | `[{id,alias,walletAddress,orgWallet,groupId, rates:[{token,rateAmount,rateType,slice_per_ms}]}]` |
| PUT | `/v1/orgs/:wallet/employees/:id` | `{group_id?, rates?}` (auth) · DELETE also |
| POST | `/v1/orgs/:wallet/pools` | `{token:'USDC', on_chain_pool_id}` (auth) |
| GET | `/v1/orgs/:wallet/pools` | `[{id,orgWallet,token,onChainPoolId, on_chain}]` |
| POST | `/v1/vaults` | `{on_chain_vault_id, name}` (auth) |
| GET | `/v1/vaults/:wallet` | `[vault]` |
| GET | `/v1/compute/yields?token=USDC` | `{token, quotes:[{protocol:'NAVI'|'SCALLOP', apy:number%}]}` |
| GET | `/v1/compute/runway?pool_id=` · `/slice` · `/max-yield` | helpers |

---

## 4. On-chain Move functions (the load-bearing part)

Type arg `<T>` = `USDC`. `ctx` is implicit (not passed in PTBs). `CLOCK` = `0x6`.
`public(package)` functions are internal — call them via the wrappers noted.

### `sweem_core::stream_pool`
| Function | Args (after pool) | Notes |
|---|---|---|
| `create_and_share<T>` (entry) | `min_coverage_weeks: u64` | shares a `StreamPool<T>`; caller = `org`. Read created id from `objectChanges`. |
| `deposit<T>` | `config, payment: Coin<T>, employees: vector<address>, rate_amounts: vector<u128>, rate_periods_ms: vector<u64>, clock` | **funds + creates/updates streams (starts streaming)**. Takes 0.25% deposit fee → treasury. Asserts coverage floor. |
| `topup<T>` | `config, payment: Coin<T>` | fund only, no stream changes. |
| `claim<T>` | `clock` → `Coin<T>` | pays caller's claimable from idle balance. Use in PTB to route into a vault. |
| `claim_and_keep<T>` (entry) | `clock` | claim → transfer to caller. |
| `claimable_amount<T>` (view) | `employee: address, clock` → `u64` | read via **devInspect** (no gas). |
| `pause_stream / resume_stream / stop_stream<T>` | `employee: address, clock` | org/PauserRole; claimant can still claim earned-so-far. |
| `withdraw_excess<T>` | — → `Coin<T>` | org pulls idle above the coverage floor. |
| `propose_org_transfer / accept_org_transfer / cancel_org_transfer<T>` | `new_org?` | two-step org handoff. |

Event **`StreamCreated<T> { pool_id, employee, rate_amount, rate_period_ms, started_at }`** — emitted
when a stream is created → used for chain-first employee discovery. Other events: `PoolFunded`,
`FundsClaimed`, `StreamPaused/Resumed/Stopped`. `StreamPool` fields (flat strings): `balance`,
`total_deposited`, `total_claimed`, `total_weekly_committed`, `org`, `streams` (Table<address,Stream>).
`Stream { rate_amount:u128, rate_period_ms:u64, claimed_at, paused_at:Option, stopped_at:Option, … }`.

### `sweem_core::employee_vault`
| Function | Args | Notes |
|---|---|---|
| `create_and_keep` (entry) | — | mints an owned `EmployeeVault` to caller. |
| `init_bucket<T>` | `vault, token_name: String` | one-time per token (`"USDC"`). |
| `deposit_to_bucket<T>` | `vault, token_name: String, coin: Coin<T>` | deposit (route a claim coin here). |
| `withdraw_from_bucket<T>` | `vault, token_name, amount: u64` → `Coin<T>` | pull liquid bucket funds out. |

### `sweem_adapters::navi`
| Function | Args (after first) | Notes |
|---|---|---|
| `store_pool_account_cap<T>` | `pool, cap: AccountCap` | one-time; cap from `lending::create_account`. |
| `store_vault_account_cap` (**non-generic**) | `vault, cap: AccountCap` | one-time per vault. |
| `pool_invest_navi<T>` | `pool, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id:u8, amount:u64` | org invests idle pool USDC. |
| `cover_claim_from_navi<T>` | `pool, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, max_amount` | tops up idle from Navi for the **caller's own** claim shortfall (safe/bounded). Precede `claim`. |
| `org_withdraw_navi<T>` | `pool, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, amount` | org-gated unwind to idle (rebalance). |
| `vault_invest_navi<T>` | `vault, token_name, storage, navi_pool, inc_v2, inc_v3, registry, clock, asset_id, amount` | employee invests vault USDC. |
| `vault_withdraw_navi<T>` | `vault, token_name, storage, navi_pool, inc_v2, inc_v3, oracle, config, clock, registry, asset_id, amount` | partial. |
| `pool_withdraw_navi<T>` | — | `public(package)`; reached via cover/org/claim. |

AccountCap: `${NAVI_LENDING_CORE_PKG}::lending::create_account() → AccountCap` (call then store in same PTB).
Position dynamic fields: `NaviPoolCapKey`/`NaviPoolPositionKey` (pool), `NaviVaultCapKey`/`NaviVaultPositionKey` (bucket); `NaviPosition { deposited_value:u64 }`.

### `sweem_adapters::scallop`
| Function | Args (after first) | Notes |
|---|---|---|
| `pool_invest_scallop<T>` | `pool, version, market, registry, clock, amount:u64` | no AccountCap needed. |
| `cover_claim_from_scallop<T>` | `pool, version, market, config, registry, clock, max_amount` | top-up for caller's claim (safe). |
| `org_withdraw_scallop<T>` | `pool, version, market, config, registry, clock, amount` | org-gated unwind. |
| `vault_invest_scallop<T>` | `vault, token_name, version, market, registry, clock, amount` | employee invests vault USDC. |
| `vault_withdraw_scallop<T>` | `vault, token_name, version, market, config, registry, clock` | **full position** (no amount). |
| `pool_withdraw_scallop<T>` | `… shortfall` | `public(package)`; partial redemption. |

Position DFs: `ScallopPoolMarketCoinKey`(sCoin DOF)/`ScallopPoolPositionKey`; vault analogues. `ScallopPosition { deposited_value:u64 }`.

### Single-protocol claim entries (`sweem_adapters::claim_liquidity[_scallop]`)
- `claim_with_liquidity<T>(pool, storage, navi_pool, inc_v2, inc_v3, oracle, registry, config, clock, asset_id) → Coin<T>` (Navi-only pool).
- `claim_with_liquidity_scallop<T>(pool, version, market, registry, config, clock) → Coin<T>` (Scallop-only pool).
- **Split pool:** chain `cover_claim_from_navi` + `cover_claim_from_scallop` + `stream_pool::claim` in one PTB instead.

### `sweem_registry::registry` (admin; AccessControl + roles)
- `add_protocol(registry, ac, name:String, adapter_package:address, yield_type:u8)` · `enable_protocol`/`disable_protocol`.
- `set_fees(config, ac, deposit_fee_bps, org_yield_fee_bps, vault_yield_fee_bps)` · `set_treasury(config, ac, treasury)`.
- `is_approved(registry, name)→bool` (view). Already configured: navi+scallop approved, fees 25/1000/1000.

---

## 5. Client lib reference

### `src/lib/tx.ts` — Transaction builders + on-chain reads
**Org / pool**
- `createPoolTx(minCoverageWeeks)` → `stream_pool::create_and_share`.
- `depositTx(poolId, totalDepositRaw, employees: {address, rateRaw, periodMs}[])` → `deposit` (fund + start). Payment via `coinWithBalance({type:USDC, balance})`; vectors via `makeMoveVec`.
- `claimTx(poolId)` → `claim_and_keep`.
- `investNaviTx(poolId, amountRaw, {needsCap})` → (create_account + `store_pool_account_cap` if needsCap) + `pool_invest_navi`.
- `investScallopTx(poolId, amountRaw)` → `pool_invest_scallop`.
- `poolHasNaviCap(client, poolId)` → bool (decide `needsCap`).
- `readPoolSummary(client, poolId)` → `{idleRaw, totalDepositedRaw, totalClaimedRaw, weeklyCommittedRaw}` (pool fields).
- `readPoolInvestments(client, poolId)` → `{naviRaw, scallopRaw}` (position DFs).
- `findCreatedPoolId(objectChanges)` → pool id.

**Employee / vault (chain-first)**
- `findMyStreamPools(client, employee)` → distinct pool ids from `StreamCreated<USDC>` events filtered by employee. **No backend.**
- `readStream(client, poolId, employee)` → `{rateAmountRaw, ratePeriodMs, paused, stopped}` from the `streams` Table DOF (null if none).
- `readPoolOrg(client, poolId)` → org address (`pool.org`).
- `findMyVault(client, owner)` → first `EmployeeVault` owned object id, or null (`getOwnedObjects`).
- `readClaimable(client, poolId, employee)` → `u64` raw via devInspect of `claimable_amount`.
- `claimToWalletTx(poolId, {coverNavi, coverScallop})` → optional covers + `claim_and_keep`.
- `claimToVaultTx(poolId, vaultId, {coverNavi, coverScallop})` → optional covers + `claim` (Coin) piped into `deposit_to_bucket`.
- `createVaultTx()` / `initBucketTx(vaultId)` → `create_and_keep` / `init_bucket<USDC>`.
- `vaultInvestNaviTx(vaultId, amountRaw, {needsCap})` → (create_account + `store_vault_account_cap` if needsCap) + `vault_invest_navi`.
- `vaultInvestScallopTx(vaultId, amountRaw)` → `vault_invest_scallop`.
- `vaultHasNaviCap(client, vaultId)` → bool (navigates vault→bucket→`NaviVaultCapKey`).
- `readVaultInvestments(client, vaultId)` → `{naviRaw, scallopRaw, idleRaw}` (bucket balance + position DFs).
- `findCreatedVaultId(objectChanges)` → vault id.

### `src/lib/api.ts` — `useSweemApi()` (dapp-kit hook)
Reads (react-query): `orgQuery`, `groupsQuery`, `employeesQuery`, `yieldsQuery`. Writes/calls:
`ensureOrg(name)`, `getOrg(w)`, `createGroup(w,name)`, `listGroups(w)`, `addEmployee(w, input)`,
`listEmployees(w)`, `createPool(w, onChainPoolId)`, `listPools(w)`, `getYields()`,
`getOrgName(orgWallet)` (best-effort, never throws — employee portal degrades to address if backend down).

---

## 6. Flows

### Org side (`Org.tsx` + `Employees.tsx`)
1. **Create org** → `ensureOrg(name)`.
2. **Create groups** → `createGroup`. (off-chain categories)
3. **Add employees** (per group, monthly USDC rate) → `addEmployee` (rate stored at registration).
4. **Fund & start** (Org card): if no pool → `createPoolTx` → `createPool` (index); then `depositTx(pool, toRaw(totalMonthly), roster)` (fund + start). Button is then **gated** — replaced by "Invest idle funds".
5. **Invest popup** (live APRs from `getYields`): choose Navi/Scallop/both → `investNaviTx`/`investScallopTx`. Investable = `idle − coverage floor`; Navi ≥ 5 USDC.
6. Org card shows pool stats from `readPoolSummary`+`readPoolInvestments` (5s poll): monthly payroll, total in pool, idle, invested Navi/Scallop, coverage floor.
   - **Streamed to date** is a **live bigint ticker** (same technique as the employee balance): base = `total_claimed` + Σ claimable at the poll (`poolState.dataUpdatedAt`), interpolated each `requestAnimationFrame` at the on-chain weekly rate `total_weekly_committed / WEEK_MS` (nano-USDC, 9 dp); re-anchors on each poll.

### Employee side (`EmployeePortal.tsx`) — chain-first
1. **Discover** → `findMyStreamPools(wallet)`; per pool `readStream` + `readPoolOrg` (+ best-effort `getOrgName`).
2. **Live balance** → poll `readClaimable` ~2s; interpolate between polls in **exact bigint** (nano-USDC) on `requestAnimationFrame`, render 9 dp so it visibly ticks. Pause when stream paused/stopped.
3. **Min-claim gate** → disable withdraw until `claimable ≥ minClaimRaw` (~16.8h for a fresh stream); show ETA.
4. **Withdraw to wallet** → `claimToWalletTx` (covers computed from `readPoolInvestments` vs idle).
5. **Withdraw to vault** → if no vault: `createVaultTx` → `findCreatedVaultId` → `initBucketTx` (+ best-effort `createVault`); then `claimToVaultTx`; then invest popup → `vaultInvestNaviTx`/`vaultInvestScallopTx` (`needsCap` from `vaultHasNaviCap`).
6. **Vault card** → `readVaultInvestments` (idle + Navi/Scallop) + "Invest more".

---

## 7. Invariants & gotchas (must carry to `fe/`)
- **Deposit fee 0.25%** taken on `deposit`/`topup` → treasury; net (≈99.75%) enters the pool.
- **Coverage floor**: ≥ `min_coverage_weeks` (=1) of total weekly payroll must stay idle; `split_balance_for_invest` blocks investing below it. So investable ≈ deposit − fee − 1 week of payroll (~76% of one month).
- **Min-claim**: a claim needs ≥ 10% of one week's earnings ⇒ **~16.8h of accrual** from the last claim (rate-independent). Surface it; don't let users think it's broken.
- **Navi min invest = 5 USDC** per leg; **Scallop vault withdraw is full-position**; **Scallop pool withdraw is partial**.
- **Numeric API fields are strings** → `Number()` before math (the `0 + "5"` = `"05"` bug).
- **Live tickers** (both the employee "claimable" and the org "streamed to date"): interpolate in **bigint** (nano-USDC), not float; show ~9 dp; update on `requestAnimationFrame`; re-anchor to the true value on each poll. `toFixed(6)` looks frozen because low-order digits move below it.
- **`cover_claim_from_*` is safe to call** — bounded to the caller's own claim shortfall; only include a protocol's cover if it actually holds a position (else it aborts when idle is short).
- **Chain-first**: employee discovery/claim must not depend on the backend (it's only an indexer/enricher).
- **Mainnet, real USDC + SUI gas** for all fund/claim/invest txs.
- **Tx exec pattern**: `useSignAndExecuteTransaction()` → `{digest}` → `client.waitForTransaction({digest, options:{showObjectChanges, showEffects}})`; read created ids from `objectChanges`.
- **tsconfig**: `target` ≥ ES2020 (BigInt literals).
