# Sweem Runtime Flow Tests — Checklist

Bun + TypeScript scripts that run FLOW TESTS against ALREADY-DEPLOYED Sweem
contracts. They do **not** deploy or publish anything.

> Every script is a **DRY RUN** by default — it builds the `Transaction` and
> prints it, hitting no chain. Pass `--execute` (or set `EXECUTE=1`) to sign and
> submit. The maintainer stays in control.

---

## A. DEPLOYMENT IS MANUAL (not done by these scripts)

The maintainer publishes the 3 Sweem packages themselves and configures the IDs:

1. `sui client publish` each of `contracts/packages-mainnet/{sweem_registry,sweem_core,sweem_adapters}`
   (registry first, then core, then adapters — adapters depend on both).
2. From the publish output, collect:
   - the 3 package IDs,
   - the shared objects created by `registry::init`: `AccessControl<REGISTRY>`,
     `ProtocolRegistry`, `ProtocolConfig`.
3. `cp deployed.example.json deployed.json` and paste the 6 IDs in.
   `deployed.json` is **gitignored**. `loadDeployed()` errors clearly if any
   required id is missing or still a `_FILL` placeholder.
4. `cp .env.example .env` and set `SUI_PRIVATE_KEY` (bech32 `suiprivkey...`).
   `.env` is gitignored; never commit a key.

These scripts assume steps 1–4 are done.

---

## B. Setup

```
cd scripts
bun install
bun run typecheck      # tsc --noEmit, proves it compiles
```

---

## C. Run order (dry run first, then --execute)

```
# OPTIONAL — post-deploy protocol config (or configure the registry by hand).
# Signer must hold the registry roles (the publisher, by default).
bun run admin-setup                # dry run: prints the tx
bun run admin-setup -- --execute   # add_protocol navi+scallop, set_fees(25/1000/1000), set_treasury

# FLOW TEST 1 — pool split across Navi + Scallop (run as the pool org).
bun run e2e:split-pool                # dry run: prints all 6 step txs
bun run e2e:split-pool -- --execute   # creates pool + cap, deposits, invests,
                                      # employee split claim, org rebalance.
# After step 1/2 in execute mode, paste the printed POOL_ID / cap into
# deployed.json (poolId / poolAccountCap) to reuse on re-runs.

# FLOW TEST 2 — EmployeeVault (run as the employee = vault owner).
bun run e2e:vault                # dry run
bun run e2e:vault -- --execute   # create vault, bucket, deposit, Navi cap,
                                 # invest Navi+Scallop, withdraw both.
```

`EXECUTE=1 bun run e2e:vault` is equivalent to passing `--execute`.

---

## D. Notes

- **5 USDC Navi floor** — every Navi-leg amount defaults to >= `5_000_000` raw.
  Lower them only above the floor (`config.ts` / env).
- **Coverage floor** — after both pool invests, idle cash must still cover
  `min_coverage_weeks * total_weekly_committed`. Defaults satisfy 1 week.
- **Min-claim gate** — `stream_pool::claim` requires >= 10% of a week's earnings.
  With dust rates a brand-new stream is not claimable immediately; let accrual
  pass (a few hours at 1 USDC/30d) before running the split-pool claim step.
- **Split vs single-protocol claim** — a pool invested in BOTH protocols cannot
  be claimed with one `claim_with_liquidity*`; the employee step uses the
  `cover_claim_from_navi` + `cover_claim_from_scallop` + `claim` chain. For a
  single-protocol pool, swap in `claim_with_liquidity` /
  `claim_with_liquidity_scallop` (see the commented block in `e2e-split-pool.ts`).
- **Funding coin** — scripts pick the largest `Coin<COIN_TYPE>` owned by the
  signer; pin one with `COIN_OBJECT` in `.env`.
- **Multi-party** — set `E1/E2/E3` to real addresses; run the employee claim
  step with that employee's `SUI_PRIVATE_KEY` (claim uses `ctx.sender()`).
