# Sweem — Whitepaper Research Dossier

> Structured research output (Phases 1–7). This is **not** the whitepaper — it is the
> research foundation, competitive analysis, architecture reconstruction, and outline
> used to write one. Confidence scores and open questions are tracked at the end.

---

## 1. Project Understanding

**Purpose.** Sweem is a streaming payroll protocol on Sui where organizations stream
salaries to employees per-millisecond, and the unclaimed payroll "float" is invested into
on-chain lending protocols to earn yield for the organization. Employees can route claimed
pay into personal yield-bearing vaults. Live on Sui mainnet.

| Dimension | Finding |
|---|---|
| **Core features** | (1) Per-token stream pools w/ ms-level accrual; (2) idle-fund yield investing (Navi, Scallop); (3) pause/resume/stop streams; (4) employee multi-token yield vaults; (5) CSV onboarding w/ AI column mapping; (6) live runway + APY compute; (7) 3-tier fee model. |
| **Main workflows** | Org: create pool → fund+start streams (1 PTB) → invest idle → manage/pause → rebalance. Employee: discover streams → watch live claimable → claim (cover from yield + claim + route to vault, 1 PTB) → invest vault. |
| **Target users** | Crypto-native orgs/DAOs paying contributors in stablecoins; their employees/contractors; treasury managers seeking yield on payroll float; developers (registry-extensible). |
| **Tech stack** | Move (Sui) contracts; Cloudflare Workers + Hono + Drizzle + Postgres (Hyperdrive) backend; Next.js + @mysten/dapp-kit + react-query + framer-motion frontends; Workers AI (Llama 3.3), Resend. |
| **Architecture style** | On-chain financial source-of-truth + off-chain metadata/UX layer. Contracts split core/registry/adapters. Stateless edge backend that never touches funds. Chain-first reads w/ DB as enrichment. |
| **Key modules** | `sweem_core` (StreamPool, EmployeeVault), `sweem_registry` (allowlist, fees, RBAC), `sweem_adapters` (Navi/Scallop). Backend: auth, sui, slice, yield, csv-mapping, resend. FE: `lib/tx.ts` (PTB builders), `lib/api.ts`. |
| **Dependencies** | @mysten/sui, OpenZeppelin Move math/access-control, Navi `lending_core`+`oracle`, Scallop `protocol`+`x`, Hono, Drizzle. |
| **External integrations** | Navi & Scallop (yield); Sui RPC; Navi/Scallop public APY APIs; Resend (OTP email); Cloudflare Workers AI; Hyperdrive→Postgres. |
| **Security mechanisms** | Wallet PersonalMessage signature auth (60s TTL, replay guard); registry approval gate on every fund move; UID-access gating (org vs registry); OZ overflow-safe `mul_div`; coverage floor; min-claim anti-spam; two-step org transfer; rate crystallization; backend holds no keys. |

### Mainnet package addresses

| Package | Address |
|---|---|
| `sweem_core` | `0x4c582aea3efe99fb68deea8b71b96eda6fba06001ed5588da83799c09f9179b4` |
| `sweem_registry` | `0x06eae4d4c2c97ab2166f88cc310a4c6f0fc66e2f9583e01ad75c99b2951cfbbd` |
| `sweem_adapters` | `0x8f0943975ec6f56f97e197713041b192e8ff9b4461c0a496bf129ed37b2866eb` |

---

## 2. Innovation Analysis

The genuinely novel element is **the convergence of three things that exist separately
elsewhere**: continuous payroll streaming + automated reinvestment of the unclaimed float +
employee-side yield routing — composed atomically via Sui PTBs.

**Innovation A — Yield-bearing payroll float ("idle money works")**
- *Problem:* Streaming guarantees a perpetually-large unclaimed balance earning 0%. Traditional payroll float and existing streaming protocols leave it idle.
- *Implementation:* Org routes idle pool balance into Navi/Scallop via adapters; positions stored as dynamic fields on the pool; a `min_coverage_weeks` floor keeps a withdrawable buffer un-invested.
- *Benefits:* Turns a cost center into yield; aligned via fee-on-yield-only.
- *Limitations:* Yield only on what stays unclaimed; partial-withdrawal yield realization differs per protocol (Navi aToken ≈ 0 yield on partial draws); APY/principal risk inherited from Navi/Scallop.

**Innovation B — Atomic claim-with-liquidity across split positions**
- *Problem:* If idle cash < claimable, funds are locked in lending positions; naive design forces multi-tx unwinds and risks shortfall.
- *Implementation:* `cover_claim_from_navi/scallop` (public, **bounded by caller's own claimable** so it can't grief the org) compose in one PTB before `claim<T>`; Scallop adapter computes exact sCoins via live exchange rate w/ ceiling rounding.
- *Benefits:* One-click claim regardless of where funds sit; gas-efficient; safe.
- *Limitations:* Employee/UI must assemble the correct protocol objects; PTB grows with number of positions.

**Innovation C — Returnless claim + composable routing**
- *Problem:* Salary destination is rigid in most systems.
- *Implementation:* `claim<T>` returns `Coin<T>` (not auto-transferred), so the same PTB can swap/split/deposit into an `EmployeeVault` `TokenBucket<T>` and re-invest.
- *Benefits:* Employees become yield earners; "salary → savings strategy" in one signature.
- *Limitations:* AUTO_MAX_YIELD resolved off-chain (trust in FE quote); multi-token swaps depend on external DEX liquidity.

**Innovation D — Registry-gated adapter pattern**
- *Problem:* Adding protocols usually means contract changes/risk.
- *Implementation:* `sweem_registry` allowlist + `is_approved` check + UID gating (`borrow_uid_mut_yield`); core has zero yield knowledge.
- *Benefits:* Extensible (USDY, Bucket LST planned) without touching core; defensible as an integration moat.
- *Limitations:* Each new protocol still needs a hand-written adapter; governance of the registry is a trust point.

**Honest assessment:** None of the *primitives* are unprecedented — streaming
(Sablier/Superfluid/Zebec/Streamflow) and payroll-yield (Franklin/Summer.fi, RebelFi) both
exist. Sweem's defensibility is the **integration + the Sui-native, PTB-atomic composition +
dual-sided yield (org float *and* employee vaults)**. That is a product/architecture moat,
not a cryptographic one.

---

## 3. Competitive Landscape

| Capability | **Sweem (Sui)** | Streamflow (Solana) | Zebec (Solana→multi) | Sablier (EVM) | Superfluid (EVM, 10 chains) |
|---|---|---|---|---|---|
| Streaming payroll | ✅ per-ms | ✅ | ✅ real-time | ✅ fixed-amount | ✅ fixed flow-rate |
| **Yield on idle/unclaimed float** | ✅ native (Navi/Scallop) | ❌ | ❌ | ❌ | ❌ |
| **Employee-side yield vaults** | ✅ multi-token | ❌ | ❌ (card/offramp focus) | ❌ | ❌ |
| Atomic claim+unwind | ✅ PTB | partial | n/a | n/a | n/a |
| Multi-token per org | ✅ pool-per-token | ✅ | ✅ | ✅ | ✅ (super tokens) |
| Pause/resume/stop | ✅ + delegated pauser | ✅ | ✅ | cancelable | flow update |
| Compliance/offramp | ❌ | partial | ✅ (Nacha, ISO 20022, card) | ❌ | ❌ |
| CSV + AI onboarding | ✅ (Llama) | basic | ✅ enterprise | ❌ | ❌ |
| Chain | Sui (parallel exec) | Solana | Solana+ | Ethereum/L2 | 10 EVM chains |
| Maturity / funding | early, mainnet-live | established | $35M raised | since 2019 | established |

**Adjacent (yield-on-payroll, non-streaming):** Franklin + Summer.fi, RebelFi (4–14% APY on
idle payroll). These validate the yield thesis but **don't stream** — Sweem is the
streaming-native version.

- **Advantages:** Only protocol combining streaming + dual-sided yield; Sui parallel execution + PTB atomicity; clean extensibility.
- **Weaknesses:** Smallest/youngest; no compliance/offramp/fiat rails (Zebec's strength); single-chain; depends on Sui DeFi depth (fewer yield venues than Solana/EVM).
- **Gaps:** No token/network effects, no audits cited, no analytics/reporting, no multi-sig/enterprise RBAC beyond pauser role.
- **Opportunities:** Sui ecosystem is yield-rich and under-served for payroll; first-mover on Sui; "payroll that pays for itself" is a sharp wedge; B2B SaaS-on-yield revenue.

---

## 4. Architecture Reconstruction

**1. System overview.** Three tiers: (a) **Move contracts** = financial truth;
(b) **edge backend** = metadata + compute + auth, fund-less; (c) **Next.js clients** =
PTB construction + signing + live UX.

**2. Component diagram (described).**

```
[fe / employee / client-test]  ──signs PTBs──▶  Sui Mainnet
        │  (dapp-kit, tx.ts)                      ├─ sweem_core (StreamPool<T>, EmployeeVault)
        │                                          ├─ sweem_registry (allowlist, fees, RBAC)
        │                                          └─ sweem_adapters ──▶ Navi / Scallop
        │ REST (signed headers)
        ▼
[Cloudflare Worker: Hono]
   ├─ auth (verifyPersonalMessageSignature)
   ├─ controllers: orgs/employees/pools/vaults/compute/ai/email
   ├─ Sui RPC reads (live balance/claimable/runway)
   ├─ Workers AI (Llama CSV map) · Resend (OTP)
   └─ Hyperdrive ──▶ Postgres (metadata, UI pre-fill)
```

**3. Data flow.** Financial state writes go client→chain directly (backend never in the
money path). Metadata writes go client→backend (signed). Reads merge DB rows with live
Sui RPC state (pool balance, positions, claimable).

**4. Request lifecycle (claim).** Employee app `findMyStreamPools` (event query) → poll
`claimable_amount` via devInspect → rAF-interpolate ticker → user clicks → `tx.ts` assembles
`cover_claim_from_*` ×N + `claim` (+ optional vault deposit/invest) → wallet signs →
`waitForTransaction` w/ objectChanges → react-query invalidate.

**5. Deployment.** Worker on CF edge (`sweem-server-mainnet.silonelabs.workers.dev`),
Postgres behind Hyperdrive; three Next.js apps (likely Vercel/CF Pages); contracts
published + upgradeable (UpgradeCaps held) on Sui mainnet.

**6. Scaling model.** Sui parallel execution: pool-per-token (not per-dept) maximizes
parallelism; per-employee streams are `Table` entries (O(1)). Edge backend is
stateless/horizontally trivial; Postgres is the only stateful bottleneck (read-mostly,
indexed). Claim PTB cost grows linearly w/ number of yield positions.

**7. Security model.** See §5.

**Assumptions (not verified in repo):**
- Frontends deploy to Vercel/CF Pages — *assumption*.
- No formal audit has occurred — *assumption* (none referenced).
- AUTO_MAX_YIELD/APY quotes are advisory and trusted from FE — *stated in docs, runtime trust unverified*.
- Postgres provider/region and HA posture — *unknown*.
- Token swap path for multi-token vaults uses an external Sui DEX — *implied, not located in code*.

---

## 5. Security Review

**Implemented strengths.**
- **No-custody backend** — worker holds no keys, builds no txns; compromise leaks metadata only.
- **Auth** — PersonalMessage sig, address-derived, 60s window (replay-bounded), per-route message binding.
- **Contract guardrails** — registry `is_approved` gate before any fund move; UID gating segregates org-only vs registry-only mutation; `cover_claim_from_*` bounded by caller's claimable (no grief); OZ overflow-safe math; coverage floor; min-claim; two-step org transfer; rate crystallization protects earned pay.

**Risks / open items.**

| Severity | Risk |
|---|---|
| High | **No audit referenced** for handwritten Navi/Scallop adapters — the highest-risk surface (oracle reads, exchange-rate math, partial redemption rounding). |
| High | **Prod config hygiene** — mainnet `ALLOWED_ORIGIN=localhost:3000` and `EMAIL_DEV_MODE=true` (OTP returned in API response). Must flip before launch. |
| Med | Registry/treasury/role keys = governance trust point; key-management posture undocumented (multisig?). |
| Med | AUTO_MAX_YIELD resolved off-chain — FE could route to a lower-yield/approved-but-suboptimal protocol; contract only checks approval, not optimality. |
| Med | Oracle dependence (Navi) — stale/manipulated price affects withdrawal valuation/fee. |
| Low | 60s auth window relies on client/server clock sync; no nonce store (timestamp-only replay guard). |
| Low | Upgradeable packages (UpgradeCaps) — upgrade key custody undocumented. |

---

## 6. Business Value Assessment

**Value proposition:** "Payroll that pays for itself." Idle payroll float (0% in TradFi/most
crypto) earns ~5–8% on Sui lending; Sweem captures a yield fee while orgs net positive vs.
the status quo.

- **Cost reduction / revenue:** Worked example from market data — $100k/mo payroll float ≈ $6k/yr yield at ~6% APY; streaming amplifies float vs. lump-sum payroll. Org keeps yield minus ~10% fee.
- **Productivity:** One-PTB fund+start; CSV+AI onboarding collapses setup; pause/resume self-serve; ms-level transparency reduces payroll disputes.
- **Operational:** No payroll intermediary; removed employees auto-extend runway; treasury optionality (rebalance protocols on-chain).
- **Revenue model (Sweem):** deposit fee (≤5%, ~0.25% suggested) + org yield fee (≤50%, ~10%) + vault yield fee (≤50%, ~10%) — recurring, yield-indexed, scales with TVL not headcount.
- **Caveat:** Value is real only where float stays unclaimed and Sui APYs hold; bear-market APY compression compresses Sweem's revenue.

---

## 7. Whitepaper Outline

**Recommended title:** *Sweem: Yield-Bearing Streaming Payroll on Sui*
(Alt: *Sweem: Programmable Payroll That Earns While It Streams*)

**Abstract (draft seed):** Sweem is a Sui-native protocol that streams employee compensation
per-millisecond while automatically investing the unclaimed payroll float into vetted lending
protocols, returning yield to the organization and enabling employees to route pay into
personal yield-bearing vaults — all composed atomically via programmable transaction blocks.

**Table of contents:**
1. Executive Summary
2. Problem Statement (idle payroll float; lump-sum inefficiency; crypto payroll gaps)
3. Solution Overview
4. Protocol Architecture (core / registry / adapters; off-chain layer)
5. Streaming & Claim Mechanics (math, coverage floor, min-claim)
6. Yield Layer & Adapter Model
7. Employee Vaults
8. Security Model
9. Fee & Revenue Model
10. Competitive Landscape
11. Performance & Scalability (Sui parallelism)
12. Roadmap
13. Risks & Disclaimers
14. Appendix: addresses, formulas, API surface

**Key diagrams needed:** 3-tier system architecture; claim-with-liquidity PTB sequence;
fund+start deposit flow; stream state machine (active/paused/stopped); fee waterfall
(gross→treasury→net); on-chain vs off-chain data split; org-float + employee-vault dual-yield map.

**Confidence by section:** Architecture 9/10 · Mechanics/math 9/10 · Security (implemented)
8/10 · Security (audit/ops posture) 3/10 · Competitive 7/10 · Business/financials 5/10
(no real TVL/usage data) · Roadmap 3/10 (inferred).

---

## 8. Missing Information

1. **Audit status / reports** for contracts and adapters.
2. **Real metrics** — TVL, active orgs/streams, yield generated, claim volume.
3. **Roadmap & token** — is there a token? Governance? Multi-chain plans?
4. **Key management** — treasury/registry/upgrade key custody (multisig?).
5. **Multi-token swap mechanism** — which DEX powers vault token routing?
6. **Legal/compliance** — KYC, jurisdiction, employment-law/tax stance, fiat offramp plans.
7. **Supported tokens beyond USDC** — code is generic `<T>` but flows hardcode USDC in places; what's actually live?
8. **Funding/team** — for investor section.
9. **SLA/HA** — Postgres provider, backup, uptime; degradation behavior if backend is down (docs say discovery is chain-first — confirm full degradation).
10. **Planned protocols** — USDY/Bucket LST timelines (registry supports yield types Y/S but adapters only Navi/Scallop today).

---

## 9. Questions for Repository Owner

1. Has any contract/adapter been audited? By whom; can we cite it?
2. Target audience priority — investors, enterprise, or developers first? (changes tone/depth)
3. Is there a token or purely a fee-revenue business? Any tokenomics to include?
4. Current live metrics you can disclose (TVL, orgs, streams)?
5. Beyond USDC — which tokens are production-supported today?
6. Multi-chain or Sui-exclusive positioning?
7. Treasury/registry/upgrade key custody model (multisig, threshold)?
8. Roadmap items + dates to feature (USDY/Bucket, compliance, offramp, analytics)?
9. Compliance posture — any legal review of "yield on payroll float" by jurisdiction?
10. Naming/branding — confirm "Sweem", tagline, logo assets for diagrams?

---

## Sources (competitive/market grounding)

- [Streamflow DAO Tool Report 2025](https://daotimes.com/streamflow-finance-dao-tool-report-for-2025/)
- [Zebec Network guide (Phemex)](https://phemex.com/academy/what-is-zebec-network-zbcn-token)
- [Superfluid overview (Gate Learn)](https://www.gate.com/learn/articles/all-you-need-to-know-about-superfluid/2661)
- [Streaming payment projects overview (CoinEx)](https://coinex.medium.com/coinex-institution-payment-lego-an-overview-of-streaming-payment-projects-ii-fcdd8b12c479)
- [Franklin payroll treasury yield (Cointelegraph)](https://cointelegraph.com/news/franklin-launches-payroll-treasury-yield-defi)
- [Yield-powered stablecoin payroll guide (RebelFi)](https://rebelfi.io/blog/stablecoin-yield-payroll-complete-2025-guide-to-crypto-salary-payments)
