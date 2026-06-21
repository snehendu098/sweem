"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Coins, TrendingUp, Wallet } from "lucide-react";

import {
  CardLabel,
  IconChip,
  MoneyValue,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { useSweemApi } from "@/lib/api";
import { minClaimRaw } from "@/lib/sweem";
import { TOKENS, toRaw, fromRaw, type TokenConfig, type TokenSymbol } from "@/lib/tokens";
import {
  protocolsForScope,
  minInvestFor,
  type ProtocolKey,
  type ProtocolDescriptor,
} from "@/lib/protocols";
import {
  findMyStreamPools,
  readStream,
  readPoolOrg,
  readClaimable,
  readPoolSummary,
  readPoolInvestments,
  findMyVault,
  findCreatedVaultId,
  createVaultTx,
  initBucketTx,
  claimToWalletTx,
  claimAndAllocateTx,
  vaultInvestNaviTx,
  vaultInvestScallopTx,
  vaultInvestSuilendTx,
  vaultInvestStsuiTx,
  vaultInvestUsdyTx,
  vaultWithdrawNaviTx,
  vaultWithdrawScallopTx,
  vaultWithdrawSuilendTx,
  vaultWithdrawStsuiTx,
  vaultWithdrawUsdyTx,
  vaultHasNaviCap,
  vaultHasBucket,
  readVaultInvestments,
  DEFAULT_USDY_SLIPPAGE_BPS,
  type StreamState,
  type CoverOpts,
  type VaultInvestments,
} from "@/lib/tx";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { Icon } from "@/components/dashboard/icons";
import { LiveTicker } from "./live-ticker";
import { TokenTabs } from "./token-tabs";
import { ActionButton, AllocRow, Modal, ProtocolRow, SlippageInput, ConnectGate } from "./ui";
import { InvoicesSection } from "./invoices-section";
import { shortAddr } from "./helpers";

// Display color per protocol leg (idle + the five yield protocols).
const LEG_COLOR: Record<"idle" | ProtocolKey, string> = {
  idle: "var(--sw-text)",
  navi: "var(--sw-mint)",
  scallop: "var(--sw-lavender)",
  suilend: "#7ec8ff",
  usdy: "#f5c451",
  stsui: "#c98bff",
};

// Saved Claim & Allocate split (percentages per off-wallet leg). The wallet leg
// is the implicit remainder: 100 − Σ(legs). `save` is the idle bucket leg; the
// rest are keyed by ProtocolKey. Persisted per-wallet in localStorage.
type AllocPct = { save: number } & Partial<Record<ProtocolKey, number>>;
const DEFAULT_ALLOC: AllocPct = { save: 20, navi: 20, scallop: 20 }; // wallet = 40%
const allocKey = (w: string) => `sweem:alloc:${w}`;

function loadAlloc(wallet?: string): AllocPct {
  if (!wallet || typeof window === "undefined") return DEFAULT_ALLOC;
  try {
    const raw = window.localStorage.getItem(allocKey(wallet));
    if (raw) return { ...DEFAULT_ALLOC, ...(JSON.parse(raw) as Partial<AllocPct>) };
  } catch {
    /* fall through to default */
  }
  return DEFAULT_ALLOC;
}

function saveAlloc(wallet: string, alloc: AllocPct) {
  try {
    window.localStorage.setItem(allocKey(wallet), JSON.stringify(alloc));
  } catch {
    /* non-fatal */
  }
}

interface PoolView {
  poolId: string;
  token: TokenConfig;
  stream: StreamState;
  org: string;
  orgName: string | null;
}

// One card per stream pool. Owns the live ticking balance + claim actions for its token.
function StreamCard({
  view,
  vaultId,
  apyOf,
  onAllocated,
  onVaultChanged,
}: {
  view: PoolView;
  vaultId: string | null;
  apyOf: (symbol: TokenSymbol, key: ProtocolKey) => number | undefined;
  onAllocated: () => void;
  onVaultChanged: (id: string) => void;
}) {
  const account = useCurrentAccount();
  const wallet = account!.address;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { poolId, token, stream, org, orgName } = view;

  // Vault scope, but pools only ever route into the same protocols a vault would
  // for this token (claimAndAllocateTx handles the per-leg builders).
  const protocols = useMemo(() => protocolsForScope("vault", token), [token]);
  const allocKeys = useMemo<(keyof AllocPct)[]>(
    () => ["save", ...protocols.map((p) => p.key)],
    [protocols],
  );

  const [busy, setBusy] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [alloc, setAlloc] = useState<AllocPct>(() => loadAlloc(wallet));
  const [saveDefault, setSaveDefault] = useState(true);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_USDY_SLIPPAGE_BPS);
  const live = !stream.paused && !stream.stopped;

  const usdyInvolved = protocols.some((p) => p.key === "usdy" && (alloc.usdy ?? 0) > 0);

  const claimQuery = useQuery({
    queryKey: ["claimable", poolId, wallet],
    refetchInterval: 2000,
    queryFn: async () => {
      const raw = await readClaimable(client, poolId, wallet, token).catch(() => 0n);
      return { raw, at: Date.now() };
    },
  });

  const baseRaw = claimQuery.data?.raw ?? 0n;
  const polledAt = claimQuery.data?.at;

  const minRaw = useMemo(
    () => minClaimRaw(stream.rateAmountRaw, stream.ratePeriodMs),
    [stream.rateAmountRaw, stream.ratePeriodMs],
  );
  const meetsMin = baseRaw >= minRaw && minRaw > 0n;
  const hoursToMin = useMemo(() => {
    const rawPerMs =
      stream.ratePeriodMs > 0n
        ? Number(stream.rateAmountRaw) / Number(stream.ratePeriodMs)
        : 0;
    if (meetsMin || rawPerMs <= 0) return 0;
    const remaining = Number(minRaw) - Number(baseRaw);
    if (remaining <= 0) return 0;
    return remaining / rawPerMs / 3_600_000;
  }, [meetsMin, minRaw, baseRaw, stream.rateAmountRaw, stream.ratePeriodMs]);

  async function computeCovers(): Promise<CoverOpts> {
    try {
      const [summary, inv] = await Promise.all([
        readPoolSummary(client, poolId),
        readPoolInvestments(client, poolId),
      ]);
      const claimable = await readClaimable(client, poolId, wallet, token).catch(() => baseRaw);
      if (summary.idleRaw >= claimable) return { coverNavi: false, coverScallop: false };
      return { coverNavi: inv.naviRaw > 0n, coverScallop: inv.scallopRaw > 0n };
    } catch {
      return { coverNavi: false, coverScallop: false };
    }
  }

  async function handleWithdrawToWallet() {
    setBusy(true);
    const t = toast.loading("Preparing claim…");
    try {
      const covers = await computeCovers();
      toast.loading("Withdrawing to wallet…", { id: t });
      const { digest } = await signAndExecute({ transaction: claimToWalletTx(poolId, covers, token) });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.success("Claimed to wallet", { id: t });
      await claimQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  async function ensureVault(): Promise<string> {
    let id = vaultId ?? (await findMyVault(client, wallet));
    if (!id) {
      toast.loading("Creating vault…");
      const created = await signAndExecute({ transaction: createVaultTx() });
      const res = await client.waitForTransaction({
        digest: created.digest,
        options: { showObjectChanges: true, showEffects: true },
      });
      id = findCreatedVaultId(res.objectChanges) ?? null;
      if (!id) throw new Error("Could not find created vault id");
      toast.loading(`Initializing ${token.symbol} bucket…`);
      const initd = await signAndExecute({ transaction: initBucketTx(id, token) });
      await client.waitForTransaction({ digest: initd.digest, options: { showEffects: true } });
      onVaultChanged(id);
    }
    return id;
  }

  // ── Claim & Allocate ────────────────────────────────────────────────────
  const legSum = protocols.reduce((s, p) => s + (alloc[p.key] ?? 0), 0) + (alloc.save ?? 0);
  const walletPct = Math.max(0, 100 - legSum);
  // Live amount preview for a percentage of the current claimable balance.
  const amt = (pct: number) => fromRaw(token, (baseRaw * BigInt(pct)) / 100n);
  // Move one leg; clamp so the editable legs never sum past 100% (wallet ≥ 0).
  function setLeg(key: keyof AllocPct, v: number) {
    setAlloc((prev) => {
      const others = allocKeys
        .filter((k) => k !== key)
        .reduce((s, k) => s + (prev[k] ?? 0), 0);
      return { ...prev, [key]: Math.max(0, Math.min(v, 100 - others)) };
    });
  }
  const naviBelowMin = (alloc.navi ?? 0) > 0 && amt(alloc.navi ?? 0) < token.navi.minInvest;

  async function handleClaimAllocate() {
    setBusy(true);
    const t = toast.loading("Preparing claim…");
    try {
      // Fresh read so the split tracks accrual; wallet absorbs any rounding/dust.
      const X = await readClaimable(client, poolId, wallet, token).catch(() => baseRaw);
      const pctRaw = (pct: number) => (X * BigInt(pct)) / 100n;
      const idleRaw = pctRaw(alloc.save ?? 0);
      const naviRaw = pctRaw(alloc.navi ?? 0);
      const scallopRaw = pctRaw(alloc.scallop ?? 0);
      const suilendRaw = pctRaw(alloc.suilend ?? 0);
      const usdyRaw = pctRaw(alloc.usdy ?? 0);
      const stsuiRaw = pctRaw(alloc.stsui ?? 0);
      const bucketDepositRaw = idleRaw + naviRaw + scallopRaw + suilendRaw + usdyRaw + stsuiRaw;
      // Navi rejects sub-minimum deposits — fold those into idle (deposited, not invested).
      const naviMinRaw = toRaw(token, token.navi.minInvest);
      const naviInvestRaw = naviRaw >= naviMinRaw ? naviRaw : 0n;

      let vid: string | null = null;
      let needsBucket = false;
      let needsNaviCap = false;
      if (bucketDepositRaw > 0n) {
        vid = await ensureVault();
        needsBucket = !(await vaultHasBucket(client, vid, token));
        if (naviInvestRaw > 0n) needsNaviCap = !(await vaultHasNaviCap(client, vid, token));
      }

      const covers = await computeCovers();
      toast.loading("Claiming & allocating…", { id: t });
      const transaction = await claimAndAllocateTx({
        poolId,
        vaultId: vid,
        wallet,
        token,
        covers,
        bucketDepositRaw,
        naviInvestRaw,
        scallopInvestRaw: scallopRaw,
        suilendInvestRaw: suilendRaw,
        usdyInvestRaw: usdyRaw,
        stsuiInvestRaw: stsuiRaw,
        needsBucket,
        needsNaviCap,
        slippageBps,
      });
      const { digest } = await signAndExecute({ transaction });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      if (saveDefault) saveAlloc(wallet, alloc);
      toast.success("Claimed & allocated", { id: t });
      setAllocOpen(false);
      await claimQuery.refetch();
      onAllocated();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  const status = stream.stopped ? "Stopped" : stream.paused ? "Paused" : "Streaming";
  const badgeClass = stream.stopped
    ? "sweem-badge-stopped"
    : stream.paused
      ? "sweem-badge-paused"
      : "sweem-badge-live";

  // Hint text per protocol leg in the allocate sheet.
  function legHint(p: ProtocolDescriptor): string {
    const apy = apyOf(token.symbol, p.key);
    if (p.key === "navi" && naviBelowMin)
      return `Below ${token.navi.minInvest} ${token.symbol} min — kept idle this claim`;
    if (apy != null) return `Live APR ${apy.toFixed(2)}%`;
    if (p.yieldType === "S") return "Staked for yield";
    if (p.yieldType === "Y") return "Yield-bearing token";
    return "Earns lending yield";
  }

  return (
    <div className="sweem-card sweem-flow-card">
      <div className="sweem-card-head">
        <div>
          <p className="sweem-card-title">{orgName ?? `Unnamed org · ${shortAddr(org)}`}</p>
          <p className="sweem-card-sub">Pool {shortAddr(poolId)}</p>
        </div>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2 py-0.5 text-[12px] font-semibold text-[var(--sw-text-muted)]">
            <TokenIcon token={token} size={14} />
            {token.symbol}
          </span>
          <span className={`sweem-badge ${badgeClass}`}>{status}</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="sweem-stat-label">Claimable now</p>
          <p className="sweem-mono text-3xl font-semibold mt-1 flex items-center gap-2">
            <LiveTicker
              baseRaw={baseRaw}
              rateRaw={stream.rateAmountRaw}
              periodMs={stream.ratePeriodMs}
              anchorAt={polledAt}
              active={live}
              decimals={token.decimals}
            />
            <span className="text-base text-[color:var(--dash-faint)]">{token.symbol}</span>
          </p>
          {!meetsMin && live && (
            <p className="sweem-hint mt-1.5">
              Withdraw unlocks in ~{hoursToMin.toFixed(1)}h (min-claim floor)
            </p>
          )}
        </div>

        <div className="sweem-actions">
          <ActionButton variant="primary" onClick={() => setAllocOpen(true)} disabled={busy || !meetsMin}>
            <Icon name="bank" size={15} strokeWidth={2} /> Claim &amp; Allocate
          </ActionButton>
          <ActionButton onClick={handleWithdrawToWallet} disabled={busy || !meetsMin}>
            <Icon name="user" size={15} strokeWidth={2.1} /> To wallet
          </ActionButton>
        </div>
      </div>

      <Modal
        open={allocOpen}
        onClose={() => (busy ? undefined : setAllocOpen(false))}
        title="Claim & Allocate"
        subtitle={
          <>
            Split your {fromRaw(token, baseRaw).toFixed(2)} {token.symbol} claim — cash gets
            whatever&apos;s left.
          </>
        }
        footer={
          <>
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--sw-text-muted)]">
              <input
                type="checkbox"
                checked={saveDefault}
                onChange={(e) => setSaveDefault(e.target.checked)}
                className="h-4 w-4 accent-[var(--dash-blue)]"
              />
              Save as my default
            </label>
            <ActionButton onClick={() => setAllocOpen(false)} disabled={busy}>
              Cancel
            </ActionButton>
            <ActionButton variant="primary" onClick={handleClaimAllocate} disabled={busy}>
              Claim &amp; Allocate
            </ActionButton>
          </>
        }
      >
        <AllocRow
          label="Cash → wallet"
          hint="Sent to your wallet now"
          pct={walletPct}
          amount={amt(walletPct)}
          symbol={token.symbol}
          accent={LEG_COLOR.idle}
        />
        <AllocRow
          label="Save (idle in vault)"
          hint="Held in your vault, ready to invest"
          pct={alloc.save ?? 0}
          amount={amt(alloc.save ?? 0)}
          symbol={token.symbol}
          accent="var(--sw-text-dim)"
          onPct={(v) => setLeg("save", v)}
          max={100 - (legSum - (alloc.save ?? 0))}
        />
        {protocols.map((p) => (
          <AllocRow
            key={p.key}
            label={p.label}
            hint={legHint(p)}
            pct={alloc[p.key] ?? 0}
            amount={amt(alloc[p.key] ?? 0)}
            symbol={token.symbol}
            accent={LEG_COLOR[p.key]}
            onPct={(v) => setLeg(p.key, v)}
            max={100 - (legSum - (alloc[p.key] ?? 0))}
          />
        ))}
        {usdyInvolved && (
          <SlippageInput bps={slippageBps} onBps={setSlippageBps} disabled={busy} />
        )}
      </Modal>
    </div>
  );
}

/* ── Vault cards ──────────────────────────────────────────────────────── */

// Invested principal per protocol (human units) + idle + custodied USDY balance.
interface VaultParts {
  idle: number;
  navi: number;
  scallop: number;
  suilend: number;
  usdy: number;
  stsui: number;
  usdyHeldY: number;
  apy: Partial<Record<ProtocolKey, number>>;
}

function partsFrom(token: TokenConfig, inv: VaultInvestments | undefined, apy: Partial<Record<ProtocolKey, number>>): VaultParts {
  return {
    idle: fromRaw(token, inv?.idleRaw ?? 0n),
    navi: fromRaw(token, inv?.naviRaw ?? 0n),
    scallop: fromRaw(token, inv?.scallopRaw ?? 0n),
    suilend: fromRaw(token, inv?.suilendRaw ?? 0n),
    usdy: fromRaw(token, inv?.usdyRaw ?? 0n),
    stsui: fromRaw(token, inv?.stsuiRaw ?? 0n),
    usdyHeldY: fromRaw(token, inv?.usdyHeldYRaw ?? 0n),
    apy,
  };
}

// Only show a protocol leg when it's offered for this token OR currently holds value.
function visibleLegs(parts: VaultParts, protocols: ProtocolDescriptor[]): ProtocolKey[] {
  const offered = new Set(protocols.map((p) => p.key));
  return (["navi", "scallop", "suilend", "usdy", "stsui"] as ProtocolKey[]).filter(
    (k) => offered.has(k) || parts[k] > 0,
  );
}

// Compound the invested legs forward; idle stays flat. One point per month.
function projectGrowth(parts: VaultParts, legs: ProtocolKey[], months = 12) {
  return Array.from({ length: months + 1 }, (_, m) => {
    const grown = legs.reduce(
      (s, k) => s + parts[k] * Math.pow(1 + (parts.apy[k] ?? 0) / 100, m / 12),
      0,
    );
    return { month: m, label: m === 0 ? "now" : `${m}mo`, value: parts.idle + grown };
  });
}

function VaultTooltip({
  active,
  payload,
  symbol,
}: {
  active?: boolean;
  payload?: { payload: { label?: string; value: number } }[];
  symbol?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">{p.label}</p>
      <p className="text-[13px] font-semibold text-white">
        {p.value.toFixed(2)} {symbol}
      </p>
    </div>
  );
}

function VaultBalanceCard({ parts, legs, token, label }: { parts: VaultParts; legs: ProtocolKey[]; token: TokenConfig; label: (k: ProtocolKey) => string }) {
  const mounted = useMounted();
  const total = parts.idle + legs.reduce((s, k) => s + parts[k], 0);
  const rows: { key: "idle" | ProtocolKey; label: string; value: number; color: string }[] = [
    { key: "idle", label: "Idle", value: parts.idle, color: LEG_COLOR.idle },
    ...legs.map((k) => ({ key: k, label: label(k), value: parts[k], color: LEG_COLOR[k] })),
  ];
  const slices = rows.filter((r) => r.value > 0).map((r) => ({ label: r.label, value: r.value, color: r.color }));
  const data = slices.length ? slices : [{ label: "Empty", value: 1, color: "var(--sw-border)" }];

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Wallet className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Vault Balance</CardLabel>
      </div>

      <div className="relative mt-3 h-[168px] w-full">
        {mounted && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={78}
                paddingAngle={slices.length > 1 ? 2 : 0}
                stroke="none"
                animationDuration={800}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <MoneyValue value={total} token={token} className="text-[24px] leading-none" iconSize={16} />
          <span className="mt-1 text-[11px] text-[var(--sw-text-dim)]">total value</span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              {r.key === "idle" ? (
                <span className="size-2.5 rounded-full" style={{ background: r.color }} />
              ) : (
                <ProtocolLogo name={r.key} size={14} />
              )}
              <span className="text-[13px] text-[var(--sw-text-muted)]">{r.label}</span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text)]">
              {r.value.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </SweemCard>
  );
}

function VaultPositionsCard({ parts, legs, token, label }: { parts: VaultParts; legs: ProtocolKey[]; token: TokenConfig; label: (k: ProtocolKey) => string }) {
  const invested = legs.reduce((s, k) => s + parts[k], 0);
  const sum = parts.idle + invested || 1;
  const rows = legs.map((k) => ({ key: k, label: label(k), value: parts[k], apy: parts.apy[k], color: LEG_COLOR[k] }));

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Coins className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Positions</CardLabel>
      </div>
      <MoneyValue value={invested} token={token} className="mt-3 text-[26px] leading-none" />
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Earning yield · {parts.idle.toFixed(2)} {token.symbol} idle
      </p>

      <div className="mt-5 flex flex-1 flex-col justify-center gap-4">
        {rows.map((r) => {
          const pct = (r.value / sum) * 100;
          const annual = r.apy != null ? (r.value * r.apy) / 100 : null;
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2.5">
                  <ProtocolLogo name={r.key} size={16} />
                  <span className="text-[var(--sw-text-muted)]">{r.label}</span>
                  <span className="text-[11px] font-medium text-[var(--sw-text-dim)]">
                    {r.apy == null ? "" : `${r.apy.toFixed(2)}% APR`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-[var(--sw-text)]">
                  {r.value.toFixed(2)}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--sw-card-inset)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: r.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(pct, 100)}%` }}
                  transition={{ type: "spring", stiffness: 160, damping: 26 }}
                />
              </div>
              {annual != null && annual > 0 && (
                <p className="mt-1.5 text-[11px] text-[var(--sw-text-dim)]">
                  ≈ {annual.toFixed(2)} {token.symbol} / yr at current rate
                </p>
              )}
            </div>
          );
        })}
      </div>
    </SweemCard>
  );
}

function VaultGrowthCard({
  parts,
  legs,
  token,
  onInvest,
}: {
  parts: VaultParts;
  legs: ProtocolKey[];
  token: TokenConfig;
  onInvest: () => void;
}) {
  const mounted = useMounted();
  const invested = legs.reduce((s, k) => s + parts[k], 0);
  const series = projectGrowth(parts, legs, 12);
  const now = series[0].value;
  const future = series[series.length - 1].value;
  const gain = future - now;

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <TrendingUp className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Projected Growth</CardLabel>
      </div>

      {invested <= 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <p className="text-[13px] text-[var(--sw-text-muted)]">
            Invest idle funds into a yield protocol to project how your vault grows.
          </p>
          <button
            onClick={onInvest}
            className="rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[12.5px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
          >
            Invest now
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-2">
            <MoneyValue value={future} token={token} className="text-[26px] leading-none" />
            <span className="mb-0.5 text-[12.5px] font-semibold text-[var(--sw-mint)]">
              +{gain.toFixed(2)} {token.symbol}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
            Projected value in 12 months at current APR
          </p>

          <div className="mt-4 h-[150px] w-full flex-1">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="vaultGrowth" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--sw-mint)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--sw-mint)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                    tick={{ fill: "var(--sw-text-dim)", fontSize: 11 }}
                    tickMargin={8}
                  />
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Tooltip content={<VaultTooltip symbol={token.symbol} />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--sw-mint)"
                    strokeWidth={2}
                    fill="url(#vaultGrowth)"
                    animationDuration={900}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </SweemCard>
  );
}

// Withdraw a vault position back into the idle bucket balance.
function WithdrawChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-[var(--sw-border)] px-3.5 py-1.5 text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function EmployeePortalScreen() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const api = useSweemApi();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [vaultSymbol, setVaultSymbol] = useState<TokenSymbol>("USDC");
  const vaultToken = TOKENS[vaultSymbol];

  // Protocols available for a personal vault in this token (L/Y/S, scope-filtered).
  const protocols = useMemo(() => protocolsForScope("vault", vaultToken), [vaultToken]);

  // Live APY for a (token, protocol) pair, resolved by the descriptor's apyEnum.
  const apyOf = (symbol: TokenSymbol, key: ProtocolKey): number | undefined => {
    const enumKey = protocolsForScope("vault", TOKENS[symbol]).find((p) => p.key === key)?.apyEnum;
    if (!enumKey) return undefined;
    const quotes = api.yieldsByToken.data?.[symbol]?.quotes ?? [];
    return quotes.find((q) => q.protocol === enumKey)?.apy;
  };

  const poolsQuery = useQuery<PoolView[]>({
    queryKey: ["myStreams", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const discovered = await findMyStreamPools(client, wallet!);
      const views = await Promise.all(
        discovered.map(async ({ poolId, token }): Promise<PoolView | null> => {
          const stream = await readStream(client, poolId, wallet!);
          if (!stream) return null;
          const org = await readPoolOrg(client, poolId);
          const orgName = org ? await api.getOrgName(org) : null;
          return { poolId, token, stream, org, orgName };
        }),
      );
      return views.filter((v): v is PoolView => v !== null);
    },
  });

  const vaultQuery = useQuery<string | null>({
    queryKey: ["myVault", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: () => findMyVault(client, wallet!),
  });
  const effectiveVault = vaultId ?? vaultQuery.data ?? null;

  const vaultInvQuery = useQuery({
    queryKey: ["vaultInv", effectiveVault, vaultSymbol],
    enabled: !!effectiveVault,
    refetchInterval: 8000,
    queryFn: () => readVaultInvestments(client, effectiveVault!, vaultToken),
  });

  const [investOpen, setInvestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_USDY_SLIPPAGE_BPS);
  // Per-protocol invest dialog state, keyed by ProtocolKey.
  const [checked, setChecked] = useState<Record<ProtocolKey, boolean>>({
    navi: true, scallop: true, suilend: false, usdy: false, stsui: false,
  });
  const [amounts, setAmounts] = useState<Record<ProtocolKey, string>>({
    navi: "", scallop: "", suilend: "", usdy: "", stsui: "",
  });
  const investIdle = vaultInvQuery.data ? fromRaw(vaultToken, vaultInvQuery.data.idleRaw) : 0;

  const yieldOpenedRef = useRef(false);
  useEffect(() => {
    if (investOpen && !yieldOpenedRef.current) {
      yieldOpenedRef.current = true;
      api.yieldsByToken.refetch().catch(() => {});
    }
    if (!investOpen) yieldOpenedRef.current = false;
  }, [investOpen, api.yieldsByToken]);

  const setCheck = (k: ProtocolKey, v: boolean) => setChecked((p) => ({ ...p, [k]: v }));
  const setAmt = (k: ProtocolKey, v: string) => setAmounts((p) => ({ ...p, [k]: v }));
  const numOf = (k: ProtocolKey) => Number(amounts[k]) || 0;

  const investUsdyInvolved = protocols.some((p) => p.key === "usdy" && checked.usdy);

  const investError = (() => {
    const active = protocols.filter((p) => checked[p.key]);
    if (active.length === 0) return "Select at least one protocol";
    let total = 0;
    for (const p of active) {
      const n = numOf(p.key);
      if (n > investIdle) return `${p.label} exceeds vault idle balance`;
      const min = minInvestFor(p.key, vaultToken);
      if (n < min) return `${p.label} requires at least ${min} ${vaultSymbol}`;
      total += n;
    }
    if (total > investIdle) return "Combined amount exceeds vault idle balance";
    return null;
  })();

  function openInvest() {
    setAmounts({ navi: "", scallop: "", suilend: "", usdy: "", stsui: "" });
    setInvestOpen(true);
  }

  async function handleConfirmInvest() {
    if (!effectiveVault || investError) return;
    const vid = effectiveVault;
    setBusy(true);
    const t = toast.loading("Investing vault funds…");
    try {
      for (const p of protocols) {
        if (!checked[p.key]) continue;
        const n = numOf(p.key);
        if (n <= 0) continue;
        const raw = toRaw(vaultToken, n);
        toast.loading(`Investing into ${p.label}…`, { id: t });
        let transaction;
        if (p.key === "navi") {
          const needsCap = !(await vaultHasNaviCap(client, vid, vaultToken));
          transaction = vaultInvestNaviTx(vid, raw, { needsCap }, vaultToken);
        } else if (p.key === "scallop") {
          transaction = vaultInvestScallopTx(vid, raw, vaultToken);
        } else if (p.key === "suilend") {
          transaction = vaultInvestSuilendTx(vid, raw, vaultToken);
        } else if (p.key === "stsui") {
          transaction = vaultInvestStsuiTx(vid, raw);
        } else {
          transaction = await vaultInvestUsdyTx(vid, raw, vaultToken, slippageBps);
        }
        const r = await signAndExecute({ transaction });
        await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
      }
      toast.success("Vault funds invested", { id: t });
      setInvestOpen(false);
      await vaultInvQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // Move a vault position back into the idle bucket.
  async function withdrawProtocol(key: ProtocolKey, parts: VaultParts) {
    if (!effectiveVault) return;
    const vid = effectiveVault;
    const label = protocols.find((p) => p.key === key)?.label ?? key;
    setBusy(true);
    const t = toast.loading(`Withdrawing from ${label}…`);
    try {
      let transaction;
      if (key === "navi") transaction = vaultWithdrawNaviTx(vid, toRaw(vaultToken, parts.navi), vaultToken);
      else if (key === "scallop") transaction = vaultWithdrawScallopTx(vid, toRaw(vaultToken, parts.scallop), vaultToken);
      else if (key === "suilend") transaction = vaultWithdrawSuilendTx(vid, vaultToken); // full position
      else if (key === "stsui") transaction = vaultWithdrawStsuiTx(vid); // full position
      else transaction = await vaultWithdrawUsdyTx(vid, toRaw(vaultToken, parts.usdyHeldY), vaultToken, slippageBps); // full Y
      const r = await signAndExecute({ transaction });
      await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
      toast.success("Moved to vault balance", { id: t });
      await vaultInvQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <DashboardPageShell title="Employee portal">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to view and claim your salary streams." />
        </div>
      </DashboardPageShell>
    );
  }

  const pools = poolsQuery.data ?? [];
  const apyMap: Partial<Record<ProtocolKey, number>> = Object.fromEntries(
    protocols.map((p) => [p.key, apyOf(vaultSymbol, p.key)]),
  );
  const parts = partsFrom(vaultToken, vaultInvQuery.data, apyMap);
  const legs = visibleLegs(parts, protocols);
  const labelOf = (k: ProtocolKey) => protocols.find((p) => p.key === k)?.label ?? k;
  const withdrawable = legs.filter((k) => parts[k] > 0);

  return (
    <DashboardPageShell
      title="Employee portal"
      subtitle="Claim your streamed salary and route it into a personal yield vault."
    >
      {/* streams */}
      {poolsQuery.isLoading ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="Scanning chain for your streams…" />
        </div>
      ) : pools.length === 0 ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="No streams found for your wallet." />
        </div>
      ) : (
        <div className="grid gap-5 mt-5">
          {pools.map((v) => (
            <StreamCard
              key={v.poolId}
              view={v}
              vaultId={effectiveVault}
              apyOf={apyOf}
              onAllocated={() => {
                vaultInvQuery.refetch();
                vaultQuery.refetch();
              }}
              onVaultChanged={(id) => setVaultId(id)}
            />
          ))}
        </div>
      )}

      {/* vault */}
      {effectiveVault && (
        <section className="mt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[17px] font-semibold text-[var(--sw-text)]">Vault</p>
                <p className="font-mono text-[12.5px] text-[var(--sw-text-muted)]">
                  {shortAddr(effectiveVault)}
                </p>
              </div>
              <TokenTabs value={vaultSymbol} onChange={setVaultSymbol} />
            </div>
            <ActionButton onClick={openInvest} disabled={busy || investIdle <= 0}>
              Invest more
            </ActionButton>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <VaultBalanceCard parts={parts} legs={legs} token={vaultToken} label={labelOf} />
            <VaultPositionsCard parts={parts} legs={legs} token={vaultToken} label={labelOf} />
            <VaultGrowthCard parts={parts} legs={legs} token={vaultToken} onInvest={openInvest} />
          </div>

          {/* per-protocol withdraw → idle */}
          {withdrawable.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {withdrawable.map((k) => (
                <WithdrawChip
                  key={k}
                  label={`Withdraw ${parts[k].toFixed(2)} from ${labelOf(k)}`}
                  onClick={() => withdrawProtocol(k, parts)}
                  disabled={busy}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <InvoicesSection />

      {/* invest dialog */}
      <Modal
        open={investOpen}
        onClose={() => setInvestOpen(false)}
        title="Invest vault funds"
        subtitle={
          <>
            Earn yield on idle {vaultSymbol} in your vault. Available now: {investIdle.toFixed(2)}{" "}
            {vaultSymbol}.
          </>
        }
        footer={
          <>
            <ActionButton onClick={() => setInvestOpen(false)}>Skip</ActionButton>
            <ActionButton variant="primary" onClick={handleConfirmInvest} disabled={busy || !!investError}>
              Invest
            </ActionButton>
          </>
        }
      >
        {protocols.map((p) => (
          <ProtocolRow
            key={p.key}
            name={p.key}
            label={p.label}
            apy={apyOf(vaultSymbol, p.key)}
            checked={checked[p.key]}
            onChecked={(v) => setCheck(p.key, v)}
            amount={amounts[p.key]}
            onAmount={(v) => setAmt(p.key, v)}
            symbol={vaultSymbol}
            max={investIdle}
          />
        ))}
        {investUsdyInvolved && (
          <SlippageInput bps={slippageBps} onBps={setSlippageBps} disabled={busy} />
        )}
        {investError && <p className="sweem-error">{investError}</p>}
      </Modal>
    </DashboardPageShell>
  );
}
