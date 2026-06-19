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
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { useSweemApi } from "@/lib/api";
import { fromRaw, toRaw, minClaimRaw, NAVI_MIN_INVEST_USDC } from "@/lib/sweem";
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
  claimToVaultTx,
  vaultInvestNaviTx,
  vaultInvestScallopTx,
  vaultHasNaviCap,
  readVaultInvestments,
  type StreamState,
  type CoverOpts,
} from "@/lib/tx";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { Icon } from "@/components/dashboard/icons";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, ProtocolRow, ConnectGate } from "./ui";
import { shortAddr } from "./helpers";

interface PoolView {
  poolId: string;
  stream: StreamState;
  org: string;
  orgName: string | null;
}

// One card per stream pool. Owns the live ticking balance + claim actions.
function StreamCard({
  view,
  vaultId,
  onWantInvest,
  onVaultChanged,
}: {
  view: PoolView;
  vaultId: string | null;
  onWantInvest: () => void;
  onVaultChanged: (id: string) => void;
}) {
  const account = useCurrentAccount();
  const wallet = account!.address;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { poolId, stream, org, orgName } = view;

  const [busy, setBusy] = useState(false);
  const live = !stream.paused && !stream.stopped;

  const claimQuery = useQuery({
    queryKey: ["claimable", poolId, wallet],
    refetchInterval: 2000,
    queryFn: async () => {
      const raw = await readClaimable(client, poolId, wallet).catch(() => 0n);
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
      const claimable = await readClaimable(client, poolId, wallet).catch(() => baseRaw);
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
      const { digest } = await signAndExecute({ transaction: claimToWalletTx(poolId, covers) });
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
      toast.loading("Initializing USDC bucket…");
      const initd = await signAndExecute({ transaction: initBucketTx(id) });
      await client.waitForTransaction({ digest: initd.digest, options: { showEffects: true } });
      onVaultChanged(id);
    }
    return id;
  }

  async function handleWithdrawToVault() {
    setBusy(true);
    const t = toast.loading("Preparing vault claim…");
    try {
      const vid = await ensureVault();
      const covers = await computeCovers();
      toast.loading("Claiming into vault…", { id: t });
      const { digest } = await signAndExecute({ transaction: claimToVaultTx(poolId, vid, covers) });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.success("Claimed into vault", { id: t });
      await claimQuery.refetch();
      onWantInvest();
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

  return (
    <div className="sweem-card sweem-flow-card">
      <div className="sweem-card-head">
        <div>
          <p className="sweem-card-title">{orgName ?? shortAddr(org)}</p>
          <p className="sweem-card-sub">Pool {shortAddr(poolId)}</p>
        </div>
        <span className={`sweem-badge ${badgeClass}`}>{status}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="sweem-stat-label">Claimable now</p>
          <p className="sweem-mono text-3xl font-semibold mt-1">
            <LiveTicker
              baseRaw={baseRaw}
              rateRaw={stream.rateAmountRaw}
              periodMs={stream.ratePeriodMs}
              anchorAt={polledAt}
              active={live}
            />{" "}
            <span className="text-base text-[color:var(--dash-faint)]">USDC</span>
          </p>
          {!meetsMin && live && (
            <p className="sweem-hint mt-1.5">
              Withdraw unlocks in ~{hoursToMin.toFixed(1)}h (min-claim floor)
            </p>
          )}
        </div>

        <div className="sweem-actions">
          <ActionButton variant="primary" onClick={handleWithdrawToWallet} disabled={busy || !meetsMin}>
            <Icon name="user" size={15} strokeWidth={2.1} /> Withdraw to wallet
          </ActionButton>
          <ActionButton onClick={handleWithdrawToVault} disabled={busy || !meetsMin}>
            <Icon name="bank" size={15} strokeWidth={2} /> Withdraw to vault
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/* ── Vault cards ──────────────────────────────────────────────────────── */

const VAULT_ALLOC = [
  { key: "idle", label: "Idle (USDC)", color: "var(--sw-text)" },
  { key: "navi", label: "Navi", color: "var(--sw-mint)" },
  { key: "scallop", label: "Scallop", color: "var(--sw-lavender)" },
] as const;

interface VaultParts {
  idle: number;
  navi: number;
  scallop: number;
  naviApy?: number;
  scallopApy?: number;
}

// Compound the invested legs forward; idle stays flat. One point per month.
function projectGrowth({ idle, navi, scallop, naviApy = 0, scallopApy = 0 }: VaultParts, months = 12) {
  return Array.from({ length: months + 1 }, (_, m) => {
    const naviV = navi * Math.pow(1 + naviApy / 100, m / 12);
    const scallopV = scallop * Math.pow(1 + scallopApy / 100, m / 12);
    return { month: m, label: m === 0 ? "now" : `${m}mo`, value: idle + naviV + scallopV };
  });
}

function VaultTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { label?: string; value: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">{p.label}</p>
      <p className="text-[13px] font-semibold text-white">${p.value.toFixed(2)}</p>
    </div>
  );
}

function VaultBalanceCard({ idle, navi, scallop }: VaultParts) {
  const mounted = useMounted();
  const total = idle + navi + scallop;
  const values: Record<string, number> = { idle, navi, scallop };
  const slices = VAULT_ALLOC.map((s) => ({ label: s.label, value: values[s.key], color: s.color })).filter(
    (s) => s.value > 0,
  );
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
              {slices.length > 0 && <Tooltip content={<VaultTooltip />} />}
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <MoneyValue value={total} className="text-[24px] leading-none" />
          <span className="mt-1 text-[11px] text-[var(--sw-text-dim)]">total value</span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {VAULT_ALLOC.map((s) => (
          <li key={s.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-[13px] text-[var(--sw-text-muted)]">{s.label}</span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text)]">
              ${values[s.key].toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </SweemCard>
  );
}

function VaultPositionsCard({ idle, navi, scallop, naviApy, scallopApy }: VaultParts) {
  const invested = navi + scallop;
  const sum = idle + navi + scallop || 1;
  const rows = [
    { label: "Navi", value: navi, apy: naviApy, color: "var(--sw-mint)" },
    { label: "Scallop", value: scallop, apy: scallopApy, color: "var(--sw-lavender)" },
  ];

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Coins className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Positions</CardLabel>
      </div>
      <MoneyValue value={invested} className="mt-3 text-[26px] leading-none" />
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Earning yield · ${idle.toFixed(2)} idle
      </p>

      <div className="mt-5 flex flex-1 flex-col justify-center gap-4">
        {rows.map((r) => {
          const pct = (r.value / sum) * 100;
          const annual = r.apy != null ? (r.value * r.apy) / 100 : null;
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                  <span className="text-[var(--sw-text-muted)]">{r.label}</span>
                  <span className="text-[11px] font-medium text-[var(--sw-text-dim)]">
                    {r.apy == null ? "" : `${r.apy.toFixed(2)}% APR`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-[var(--sw-text)]">
                  ${r.value.toFixed(2)}
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
                  ≈ ${annual.toFixed(2)} / yr at current rate
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
  idle,
  navi,
  scallop,
  naviApy,
  scallopApy,
  onInvest,
}: VaultParts & { onInvest: () => void }) {
  const mounted = useMounted();
  const invested = navi + scallop;
  const series = projectGrowth({ idle, navi, scallop, naviApy, scallopApy }, 12);
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
            Invest idle funds into Navi or Scallop to project how your vault grows.
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
            <MoneyValue value={future} className="text-[26px] leading-none" />
            <span className="mb-0.5 text-[12.5px] font-semibold text-[var(--sw-mint)]">
              +${gain.toFixed(2)}
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
                  <Tooltip content={<VaultTooltip />} />
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

export function EmployeePortalScreen() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const api = useSweemApi();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [vaultId, setVaultId] = useState<string | null>(null);

  const poolsQuery = useQuery<PoolView[]>({
    queryKey: ["myStreams", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const ids = await findMyStreamPools(client, wallet!);
      const views = await Promise.all(
        ids.map(async (poolId): Promise<PoolView | null> => {
          const stream = await readStream(client, poolId, wallet!);
          if (!stream) return null;
          const org = await readPoolOrg(client, poolId);
          const orgName = org ? await api.getOrgName(org) : null;
          return { poolId, stream, org, orgName };
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
    queryKey: ["vaultInv", effectiveVault],
    enabled: !!effectiveVault,
    refetchInterval: 8000,
    queryFn: () => readVaultInvestments(client, effectiveVault!),
  });

  const [investOpen, setInvestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [naviYes, setNaviYes] = useState(true);
  const [scallopYes, setScallopYes] = useState(true);
  const [naviAmt, setNaviAmt] = useState("");
  const [scallopAmt, setScallopAmt] = useState("");
  const investIdleUsdc = vaultInvQuery.data ? fromRaw(vaultInvQuery.data.idleRaw) : 0;

  const yieldOpenedRef = useRef(false);
  useEffect(() => {
    if (investOpen && !yieldOpenedRef.current) {
      yieldOpenedRef.current = true;
      api.yieldsQuery.refetch().catch(() => {});
    }
    if (!investOpen) yieldOpenedRef.current = false;
  }, [investOpen, api.yieldsQuery]);

  const quotes = api.yieldsQuery.data?.quotes ?? [];
  const naviApy = quotes.find((q) => q.protocol === "NAVI")?.apy;
  const scallopApy = quotes.find((q) => q.protocol === "SCALLOP")?.apy;

  const naviNum = Number(naviAmt) || 0;
  const scallopNum = Number(scallopAmt) || 0;
  const investError = (() => {
    if (naviYes) {
      if (naviNum > investIdleUsdc) return "Navi exceeds vault idle balance";
      if (naviNum < NAVI_MIN_INVEST_USDC) return `Navi requires at least ${NAVI_MIN_INVEST_USDC} USDC`;
    }
    if (scallopYes && scallopNum > investIdleUsdc) return "Scallop exceeds vault idle balance";
    if (naviYes && scallopYes && naviNum + scallopNum > investIdleUsdc)
      return "Combined amount exceeds vault idle balance";
    if (!naviYes && !scallopYes) return "Select at least one protocol";
    return null;
  })();

  function openInvest() {
    setNaviAmt("");
    setScallopAmt("");
    setInvestOpen(true);
  }

  async function handleConfirmInvest() {
    if (!effectiveVault || investError) return;
    setBusy(true);
    const t = toast.loading("Investing vault funds…");
    try {
      if (naviYes && naviNum > 0) {
        const needsCap = !(await vaultHasNaviCap(client, effectiveVault));
        toast.loading("Investing into Navi…", { id: t });
        const r = await signAndExecute({
          transaction: vaultInvestNaviTx(effectiveVault, toRaw(naviNum), { needsCap }),
        });
        await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
      }
      if (scallopYes && scallopNum > 0) {
        toast.loading("Investing into Scallop…", { id: t });
        const r = await signAndExecute({
          transaction: vaultInvestScallopTx(effectiveVault, toRaw(scallopNum)),
        });
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
  const vinv = vaultInvQuery.data;

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
              onWantInvest={openInvest}
              onVaultChanged={(id) => setVaultId(id)}
            />
          ))}
        </div>
      )}

      {/* vault */}
      {effectiveVault && (
        <section className="mt-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[17px] font-semibold text-[var(--sw-text)]">Vault</p>
              <p className="font-mono text-[12.5px] text-[var(--sw-text-muted)]">
                {shortAddr(effectiveVault)}
              </p>
            </div>
            <ActionButton onClick={openInvest} disabled={busy || investIdleUsdc <= 0}>
              Invest more
            </ActionButton>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <VaultBalanceCard
              idle={fromRaw(vinv?.idleRaw ?? 0n)}
              navi={fromRaw(vinv?.naviRaw ?? 0n)}
              scallop={fromRaw(vinv?.scallopRaw ?? 0n)}
            />
            <VaultPositionsCard
              idle={fromRaw(vinv?.idleRaw ?? 0n)}
              navi={fromRaw(vinv?.naviRaw ?? 0n)}
              scallop={fromRaw(vinv?.scallopRaw ?? 0n)}
              naviApy={naviApy}
              scallopApy={scallopApy}
            />
            <VaultGrowthCard
              idle={fromRaw(vinv?.idleRaw ?? 0n)}
              navi={fromRaw(vinv?.naviRaw ?? 0n)}
              scallop={fromRaw(vinv?.scallopRaw ?? 0n)}
              naviApy={naviApy}
              scallopApy={scallopApy}
              onInvest={openInvest}
            />
          </div>
        </section>
      )}

      {/* invest dialog */}
      <Modal
        open={investOpen}
        onClose={() => setInvestOpen(false)}
        title="Invest vault funds"
        subtitle={<>Earn yield on idle USDC in your vault. Available now: {investIdleUsdc.toFixed(2)} USDC.</>}
        footer={
          <>
            <ActionButton onClick={() => setInvestOpen(false)}>Skip</ActionButton>
            <ActionButton variant="primary" onClick={handleConfirmInvest} disabled={busy || !!investError}>
              Invest
            </ActionButton>
          </>
        }
      >
        <ProtocolRow
          name="Navi"
          apy={naviApy}
          checked={naviYes}
          onChecked={setNaviYes}
          amount={naviAmt}
          onAmount={setNaviAmt}
        />
        <ProtocolRow
          name="Scallop"
          apy={scallopApy}
          checked={scallopYes}
          onChecked={setScallopYes}
          amount={scallopAmt}
          onAmount={setScallopAmt}
        />
        {investError && <p className="sweem-error">{investError}</p>}
      </Modal>
    </DashboardPageShell>
  );
}
