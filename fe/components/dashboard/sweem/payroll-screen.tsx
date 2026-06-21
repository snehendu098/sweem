"use client";

import { useMemo, useState } from "react";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Coins, Receipt, Wallet } from "lucide-react";

import {
  CardLabel,
  IconChip,
  MoneyValue,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { TokenIcon } from "@/components/sweem-ui/token-icon";

import { cn } from "@/lib/utils";
import { MONTH_MS, weeklyCommitRaw } from "@/lib/sweem";
import { TOKENS, toRaw, fromRaw, type TokenConfig, type TokenSymbol } from "@/lib/tokens";
import type { Employee } from "@/lib/api";
import { protocolsForScope, minInvestFor, type ProtocolKey } from "@/lib/protocols";
import {
  createPoolTx,
  depositTx,
  findCreatedPoolId,
  investNaviTx,
  investScallopTx,
  investSuilendTx,
  investUsdyTx,
  pauseStreamTx,
  poolHasNaviCap,
  rebalanceTx,
  resumeStreamTx,
  topupTx,
  DEFAULT_USDY_SLIPPAGE_BPS,
  type EmployeeStream,
  type PoolBucket,
} from "@/lib/tx";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { useOrgPool } from "./use-org-pool";
import { TokenTabs } from "./token-tabs";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, PercentChips, ProtocolRow, SlippageInput, ConnectGate } from "./ui";
import { monthlyRate, shortAddr } from "./helpers";

const ALLOC = [
  { key: "idle", label: "Idle (liquid)", color: "var(--sw-text)" },
  { key: "navi", label: "Navi", color: "var(--sw-mint)" },
  { key: "scallop", label: "Scallop", color: "var(--sw-lavender)" },
  { key: "suilend", label: "Suilend", color: "#6bb8f5" },
  { key: "usdy", label: "Ondo USDY", color: "#f5c46b" },
] as const;

function ChartTooltip({
  active,
  payload,
  suffix = "",
  symbol,
}: {
  active?: boolean;
  payload?: { name?: string; payload: { name?: string; label?: string; value: number } }[];
  suffix?: string;
  symbol?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">
        {p.label ?? p.name}
      </p>
      <p className="text-[13px] font-semibold text-white">
        {p.value.toFixed(2)} {symbol}
        {suffix}
      </p>
    </div>
  );
}

// Donut of where the pool sits (idle vs each lending protocol), total in the hole.
function PoolBalanceCard({
  total,
  idle,
  navi,
  scallop,
  suilend,
  usdy,
  token,
  onTopup,
  onRebalance,
}: {
  total: number;
  idle: number;
  navi: number;
  scallop: number;
  suilend: number;
  usdy: number;
  token: TokenConfig;
  onTopup?: () => void;
  onRebalance?: () => void;
}) {
  const mounted = useMounted();
  const values: Record<string, number> = { idle, navi, scallop, suilend, usdy };
  const slices = ALLOC.map((s) => ({ label: s.label, value: values[s.key], color: s.color })).filter(
    (s) => s.value > 0,
  );
  const data = slices.length ? slices : [{ label: "Empty", value: 1, color: "var(--sw-border)" }];

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Wallet className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Total in Pool</CardLabel>
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
          <span className="mt-1 text-[11px] text-[var(--sw-text-dim)]">in pool</span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {ALLOC.map((s) => (
          <li key={s.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <ProtocolLogo name={s.key} size={18} accent={s.color} />
              <span className="text-[13px] text-[var(--sw-text-muted)]">{s.label}</span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text)]">
              {values[s.key].toFixed(2)}
            </span>
          </li>
        ))}
      </ul>

      {(onTopup || onRebalance) && (
        <div className="mt-4 flex gap-2">
          {onTopup && (
            <ActionButton onClick={onTopup}>
              Top up
            </ActionButton>
          )}
          {onRebalance && (
            <ActionButton onClick={onRebalance}>
              Rebalance
            </ActionButton>
          )}
        </div>
      )}
    </SweemCard>
  );
}

const BUCKETS: { key: PoolBucket; label: string }[] = [
  { key: "idle", label: "Idle" },
  { key: "navi", label: "Navi" },
  { key: "scallop", label: "Scallop" },
  { key: "suilend", label: "Suilend" },
  { key: "usdy", label: "Ondo USDY" },
];

const PROTOCOL_LABEL: Partial<Record<PoolBucket, string>> = Object.fromEntries(
  BUCKETS.map((b) => [b.key, b.label]),
);

// Segmented picker over the pool's three buckets, showing each one's balance. The
// `exclude` bucket (the other side of a rebalance) is disabled.
function BucketPicker({
  value,
  onChange,
  exclude,
  balances,
  symbol,
}: {
  value: PoolBucket;
  onChange: (b: PoolBucket) => void;
  exclude: PoolBucket;
  balances: Record<PoolBucket, number>;
  symbol: string;
}) {
  return (
    <div className="flex gap-2">
      {BUCKETS.map((b) => {
        const disabled = b.key === exclude;
        const active = b.key === value;
        return (
          <button
            key={b.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(b.key)}
            className={cn(
              "flex-1 rounded-xl border px-3 py-2 text-left transition-colors",
              active
                ? "border-[var(--sw-mint)] bg-[rgba(196,245,107,0.08)]"
                : "border-[var(--sw-border)] bg-[var(--sw-card-inset)] hover:border-[var(--sw-border-strong)]",
              disabled && "cursor-not-allowed opacity-40",
            )}
          >
            <span className="block text-[13px] font-semibold text-[var(--sw-text)]">{b.label}</span>
            <span className="block text-[11.5px] tabular-nums text-[var(--sw-text-dim)]">
              {balances[b.key].toFixed(2)} {symbol}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Where idle funds are deployed: one progress bar per protocol, sized vs the pool.
function InvestedCard({
  total,
  idle,
  navi,
  scallop,
  suilend,
  usdy,
  token,
}: {
  total: number;
  idle: number;
  navi: number;
  scallop: number;
  suilend: number;
  usdy: number;
  token: TokenConfig;
}) {
  const invested = navi + scallop + suilend + usdy;
  const sum = total > 0 ? total : 1;
  const rows = [
    { key: "navi", label: "Navi", value: navi, color: "var(--sw-mint)" },
    { key: "scallop", label: "Scallop", value: scallop, color: "var(--sw-lavender)" },
    { key: "suilend", label: "Suilend", value: suilend, color: "#6bb8f5" },
    { key: "usdy", label: "Ondo USDY", value: usdy, color: "#f5c46b" },
  ];

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Coins className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Invested in protocols</CardLabel>
      </div>
      <MoneyValue value={invested} token={token} className="mt-3 text-[26px] leading-none" />
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Idle funds earning yield · {idle.toFixed(2)} {token.symbol} still liquid
      </p>

      <div className="mt-5 flex flex-1 flex-col justify-center gap-4">
        {rows.map((r) => {
          const pct = (r.value / sum) * 100;
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2.5">
                  <ProtocolLogo name={r.key} size={18} accent={r.color} />
                  <span className="text-[var(--sw-text-muted)]">{r.label}</span>
                </span>
                <span className="font-semibold tabular-nums text-[var(--sw-text)]">
                  {r.value.toFixed(2)}
                  <span className="ml-1 text-[11.5px] font-medium text-[var(--sw-text-dim)]">
                    {pct.toFixed(0)}%
                  </span>
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
            </div>
          );
        })}
      </div>
    </SweemCard>
  );
}

// Per-employee monthly bars + the weekly coverage floor as context.
function MonthlyPayrollCard({
  employees,
  totalMonthly,
  floor,
  token,
}: {
  employees: Employee[];
  totalMonthly: number;
  floor: number;
  token: TokenConfig;
}) {
  const mounted = useMounted();
  const data = employees
    .map((e) => ({ name: e.alias, label: e.alias, value: monthlyRate(e, token.symbol) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <IconChip>
            <Receipt className="size-[18px]" strokeWidth={2} />
          </IconChip>
          <CardLabel className="text-[15px] text-[var(--sw-text)]">Monthly Payroll</CardLabel>
        </div>
        <MoneyValue value={totalMonthly} token={token} className="text-[20px] leading-none" iconSize={15} />
      </div>

      <div className="mt-3 h-[168px] w-full flex-1">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
            No active streams yet.
          </div>
        ) : mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fill: "var(--sw-text-dim)", fontSize: 11 }}
                tickMargin={10}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)", radius: 8 }}
                content={<ChartTooltip suffix="/mo" symbol={token.symbol} />}
              />
              <Bar dataKey="value" radius={[8, 8, 8, 8]} maxBarSize={42} animationDuration={900}>
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={8}
                  formatter={(v) => Number(v ?? 0).toFixed(2)}
                  fill="var(--sw-text-muted)"
                  fontSize={11}
                  fontWeight={600}
                />
                {data.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? "var(--sw-mint)" : "var(--sw-lavender)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <p className="mt-3 text-[12.5px] text-[var(--sw-text-dim)]">
        Coverage floor · {floor.toFixed(2)} {token.symbol}/wk reserved
      </p>
    </SweemCard>
  );
}

export function PayrollScreen() {
  const {
    wallet,
    api,
    client,
    org,
    employees,
    poolStateByToken,
    poolIdByToken,
    totalMonthlyByToken,
    poolStateQuery,
    anchorAt,
  } = useOrgPool();
  const qc = useQueryClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const token = TOKENS[symbol];
  const st = poolStateByToken[symbol];
  const totalMonthly = totalMonthlyByToken[symbol];
  const onChainPoolId = poolIdByToken[symbol];
  const { funded, idle, navi, scallop, suilend, usdy, totalInPool, floor } = st;

  // Pool-scope protocols for this token (navi, scallop, suilend, usdy — stsui excluded).
  const protocols = useMemo(() => protocolsForScope("pool", token), [token]);

  const [busy, setBusy] = useState(false);

  // invest dialog state — descriptor-driven per-protocol checkbox + amount.
  const [investOpen, setInvestOpen] = useState(false);
  const [poolId, setPoolId] = useState("");
  const [investable, setInvestable] = useState(0);
  const [coverageFloor, setCoverageFloor] = useState(0);
  const [checkedByKey, setCheckedByKey] = useState<Record<ProtocolKey, boolean>>(
    {} as Record<ProtocolKey, boolean>,
  );
  const [amountByKey, setAmountByKey] = useState<Record<ProtocolKey, string>>(
    {} as Record<ProtocolKey, string>,
  );
  const [slippageBps, setSlippageBps] = useState(DEFAULT_USDY_SLIPPAGE_BPS);

  // top-up dialog
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmt, setTopupAmt] = useState("");

  // rebalance dialog
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [rbFrom, setRbFrom] = useState<PoolBucket>("idle");
  const [rbTo, setRbTo] = useState<PoolBucket>("navi");
  const [rbAmt, setRbAmt] = useState("");

  const balances: Record<PoolBucket, number> = { idle, navi, scallop, suilend, usdy };
  const rbAmtNum = Number(rbAmt) || 0;
  const rbUsesUsdy = rbFrom === "usdy" || rbTo === "usdy";
  const rebalanceError = (() => {
    if (rbFrom === rbTo) return "Choose two different buckets";
    if (rbAmtNum <= 0) return null;
    if (rbAmtNum > balances[rbFrom]) return `Amount exceeds ${rbFrom} balance`;
    if (rbTo !== "idle") {
      const min = minInvestFor(rbTo, token);
      if (rbAmtNum < min)
        return `${PROTOCOL_LABEL[rbTo] ?? rbTo} requires at least ${min} ${symbol}`;
    }
    return null;
  })();

  const quotes = api.yieldsByToken.data?.[symbol]?.quotes ?? [];
  const apyOf = (key: ProtocolKey) => {
    const enumKey = protocols.find((p) => p.key === key)?.apyEnum;
    return quotes.find((q) => q.protocol === enumKey)?.apy;
  };

  // Reset the descriptor-driven invest state for the current protocol set: all
  // checked, empty amounts. Called whenever an invest dialog is opened.
  function resetInvestForm() {
    const checked = {} as Record<ProtocolKey, boolean>;
    const amounts = {} as Record<ProtocolKey, string>;
    for (const p of protocols) {
      checked[p.key] = true;
      amounts[p.key] = "";
    }
    setCheckedByKey(checked);
    setAmountByKey(amounts);
    setSlippageBps(DEFAULT_USDY_SLIPPAGE_BPS);
  }

  // ── fund & start ────────────────────────────────────────────────────────────
  async function handleFundAndStart() {
    if (!wallet || funded) return;
    if (employees.length === 0) {
      toast.error("Add employees before funding");
      return;
    }
    setBusy(true);
    const t = toast.loading("Preparing pool…");
    try {
      const pools = await api.listPools(wallet);
      let createdPoolId = pools.find((p) => p.token === symbol)?.onChainPoolId;

      if (!createdPoolId) {
        toast.loading("Creating stream pool…", { id: t });
        const { digest } = await signAndExecute({ transaction: createPoolTx(1, token) });
        const res = await client.waitForTransaction({
          digest,
          options: { showObjectChanges: true, showEffects: true },
        });
        const created = findCreatedPoolId(res.objectChanges);
        if (!created) throw new Error("Could not find created pool id");
        createdPoolId = created;
        await api.createPool(wallet, symbol, created);
      }

      const roster: EmployeeStream[] = employees
        .filter((e) => monthlyRate(e, symbol) > 0)
        .map((e) => ({
          address: e.walletAddress,
          rateRaw: toRaw(token, monthlyRate(e, symbol)),
          periodMs: BigInt(MONTH_MS),
        }));
      if (roster.length === 0) throw new Error(`No employees with a ${symbol} rate`);

      toast.loading("Funding pool & starting streams…", { id: t });
      const dep = await signAndExecute({
        transaction: depositTx(createdPoolId, toRaw(token, totalMonthly), roster, token),
      });
      await client.waitForTransaction({
        digest: dep.digest,
        options: { showEffects: true, showObjectChanges: true },
      });

      const floorRaw = roster.reduce(
        (acc, r) => acc + weeklyCommitRaw(r.rateRaw, r.periodMs),
        0n,
      );

      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await poolStateQuery.refetch();

      // open invest dialog
      setPoolId(createdPoolId);
      setInvestable(Math.max(0, totalMonthly - fromRaw(token, floorRaw)));
      setCoverageFloor(fromRaw(token, floorRaw));
      resetInvestForm();
      await api.yieldsByToken.refetch();
      toast.success("Pool funded, streams live", { id: t });
      setInvestOpen(true);
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  function openInvestMore() {
    if (!onChainPoolId) return;
    setPoolId(onChainPoolId);
    setInvestable(Math.max(0, idle - floor));
    setCoverageFloor(floor);
    resetInvestForm();
    setInvestOpen(true);
  }

  const amountNumOf = (key: ProtocolKey) => Number(amountByKey[key]) || 0;
  const usdyChecked = !!checkedByKey.usdy;
  const validationError = (() => {
    const active = protocols.filter((p) => checkedByKey[p.key]);
    if (active.length === 0) return "Select at least one protocol";
    let combined = 0;
    for (const p of active) {
      const amt = amountNumOf(p.key);
      combined += amt;
      if (amt > investable) return `${p.label} amount exceeds investable balance`;
      const min = minInvestFor(p.key, token);
      if (amt < min) return `${p.label} requires at least ${min} ${symbol}`;
    }
    if (combined > investable) return "Combined amount exceeds investable balance";
    return null;
  })();

  async function handleConfirmInvest() {
    if (!poolId || validationError) return;
    setBusy(true);
    const t = toast.loading("Investing idle funds…");
    try {
      for (const p of protocols) {
        if (!checkedByKey[p.key]) continue;
        const amt = amountNumOf(p.key);
        if (amt <= 0) continue;
        const amountRaw = toRaw(token, amt);
        toast.loading(`Investing into ${p.label}…`, { id: t });
        let transaction;
        if (p.key === "navi") {
          const needsCap = !(await poolHasNaviCap(client, poolId));
          transaction = investNaviTx(poolId, amountRaw, { needsCap }, token);
        } else if (p.key === "scallop") {
          transaction = investScallopTx(poolId, amountRaw, token);
        } else if (p.key === "suilend") {
          transaction = investSuilendTx(poolId, amountRaw, token);
        } else {
          transaction = await investUsdyTx(poolId, amountRaw, token, slippageBps);
        }
        const r = await signAndExecute({ transaction });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
      toast.success("Idle funds invested", { id: t });
      setInvestOpen(false);
      await poolStateQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── top up the pool's idle balance ──────────────────────────────────────────
  // Works even before any stream exists: if this token has no pool yet, create one
  // first so funds can be parked in it ahead of funding streams.
  async function handleTopup() {
    if (!wallet) return;
    const amt = Number(topupAmt) || 0;
    if (amt <= 0) {
      toast.error("Enter an amount to top up");
      return;
    }
    setBusy(true);
    const t = toast.loading(`Topping up ${amt} ${symbol}…`);
    try {
      let pid = onChainPoolId;
      if (!pid) {
        toast.loading("Creating stream pool…", { id: t });
        const { digest } = await signAndExecute({ transaction: createPoolTx(1, token) });
        const res = await client.waitForTransaction({
          digest,
          options: { showObjectChanges: true, showEffects: true },
        });
        const created = findCreatedPoolId(res.objectChanges);
        if (!created) throw new Error("Could not find created pool id");
        pid = created;
        await api.createPool(wallet, symbol, created);
        await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      }
      toast.loading(`Topping up ${amt} ${symbol}…`, { id: t });
      const r = await signAndExecute({ transaction: topupTx(pid, toRaw(token, amt), token) });
      await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
      await poolStateQuery.refetch();
      toast.success("Pool topped up", { id: t });
      setTopupOpen(false);
      setTopupAmt("");
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── rebalance funds between idle / Navi / Scallop ────────────────────────────
  async function handleRebalance() {
    if (!onChainPoolId || rebalanceError || rbAmtNum <= 0) return;
    setBusy(true);
    const t = toast.loading(`Moving ${rbAmtNum} ${symbol} · ${rbFrom} → ${rbTo}…`);
    try {
      const needsNaviCap = rbTo === "navi" ? !(await poolHasNaviCap(client, onChainPoolId)) : false;
      const transaction = await rebalanceTx({
        poolId: onChainPoolId,
        token,
        from: rbFrom,
        to: rbTo,
        amountRaw: toRaw(token, rbAmtNum),
        needsNaviCap,
        slippageBps,
      });
      const r = await signAndExecute({ transaction });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await poolStateQuery.refetch();
      toast.success("Pool rebalanced", { id: t });
      setRebalanceOpen(false);
      setRbAmt("");
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── start a stream for an employee added after the pool was funded ──────────
  // Reuses `deposit`, which both tops up the pool and creates the stream row.
  // We deposit one month of this employee's salary so the pool stays above its
  // coverage floor with the new commitment added.
  async function handleStartStream(employee: Employee) {
    if (!onChainPoolId) return;
    const rate = monthlyRate(employee, symbol);
    if (rate <= 0) return;
    setBusy(true);
    const t = toast.loading(`Starting stream · funding ${rate.toFixed(2)} ${symbol}…`);
    try {
      const roster = [
        {
          address: employee.walletAddress,
          rateRaw: toRaw(token, rate),
          periodMs: BigInt(MONTH_MS),
        },
      ];
      const r = await signAndExecute({
        transaction: depositTx(onChainPoolId, toRaw(token, rate), roster, token),
      });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await poolStateQuery.refetch();
      toast.success(`Stream started for ${employee.alias}`, { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── start every pending employee's stream in one tx ─────────────────────────
  // The pool is already funded, so we deposit a zero-value payment: `deposit` then
  // just registers the stream rows for all pending employees at once.
  async function handleStartAll(pending: Employee[]) {
    if (!onChainPoolId || pending.length === 0) return;
    setBusy(true);
    const t = toast.loading(`Starting ${pending.length} stream(s)…`);
    try {
      const rosterStreams: EmployeeStream[] = pending.map((e) => ({
        address: e.walletAddress,
        rateRaw: toRaw(token, monthlyRate(e, symbol)),
        periodMs: BigInt(MONTH_MS),
      }));
      const r = await signAndExecute({
        transaction: depositTx(onChainPoolId, 0n, rosterStreams, token),
      });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await poolStateQuery.refetch();
      toast.success(`Started ${pending.length} stream(s)`, { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── pause / resume a single employee's stream ───────────────────────────────
  async function handleToggleStream(employee: string, paused: boolean) {
    if (!onChainPoolId) return;
    setBusy(true);
    const t = toast.loading(paused ? "Resuming stream…" : "Pausing stream…");
    try {
      const tx = paused
        ? resumeStreamTx(onChainPoolId, employee, token)
        : pauseStreamTx(onChainPoolId, employee, token);
      const r = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true },
      });
      await poolStateQuery.refetch();
      toast.success(paused ? "Stream resumed" : "Stream paused", { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── gates ─────────────────────────────────────────────────────────────────
  if (!wallet) {
    return (
      <DashboardPageShell title="Payroll">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to fund and stream payroll." />
        </div>
      </DashboardPageShell>
    );
  }
  if (!org) {
    return (
      <DashboardPageShell title="Payroll">
        <div className="sweem-card mt-5">
          <ConnectGate message="Create your organization on the Overview page first." />
        </div>
      </DashboardPageShell>
    );
  }

  const roster = employees.filter((e) => monthlyRate(e, symbol) > 0);
  const byEmployee = st.byEmployee;
  const statusByEmployee = st.statusByEmployee;
  // Funded employees whose on-chain stream row doesn't exist yet, eligible for a
  // single bulk "Start all streams".
  const pending = funded ? roster.filter((e) => !statusByEmployee[e.walletAddress]) : [];

  return (
    <DashboardPageShell
      title="Payroll"
      subtitle={
        funded
          ? "Streams are live. Invest idle funds to earn yield while salary streams."
          : "Fund the pool to start streaming salaries per millisecond."
      }
    >
      {/* header: token tabs + status + primary action */}
      <div className="mt-5 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <TokenTabs value={symbol} onChange={setSymbol} />
          <div className="flex items-center gap-2.5">
            <span
              className={
                funded
                  ? "size-2 rounded-full bg-[var(--sw-mint)]"
                  : "size-2 rounded-full bg-[var(--sw-text-dim)]"
              }
            />
            <div>
              <p className="text-[15px] font-semibold text-[var(--sw-text)]">
                {funded ? "Streaming live" : "Ready to fund"}
              </p>
              <p className="text-[12.5px] text-[var(--sw-text-muted)]">
                {roster.length} employee(s) · {totalMonthly.toFixed(2)} {symbol} / month
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {funded && pending.length > 0 && (
            <ActionButton variant="primary" onClick={() => handleStartAll(pending)} disabled={busy}>
              Start all streams ({pending.length})
            </ActionButton>
          )}
          {funded ? (
            <ActionButton
              variant={pending.length > 0 ? "secondary" : "primary"}
              onClick={openInvestMore}
              disabled={busy || idle <= floor}
            >
              Invest idle funds
            </ActionButton>
          ) : (
            <ActionButton
              variant="primary"
              onClick={handleFundAndStart}
              disabled={busy || roster.length === 0}
            >
              Fund &amp; start
            </ActionButton>
          )}
        </div>
      </div>

      {/* pool / protocol breakdown cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PoolBalanceCard
          total={totalInPool}
          idle={idle}
          navi={navi}
          scallop={scallop}
          suilend={suilend}
          usdy={usdy}
          token={token}
          onTopup={() => setTopupOpen(true)}
          onRebalance={totalInPool > 0 ? () => setRebalanceOpen(true) : undefined}
        />
        <InvestedCard
          total={totalInPool}
          idle={idle}
          navi={navi}
          scallop={scallop}
          suilend={suilend}
          usdy={usdy}
          token={token}
        />
        <MonthlyPayrollCard employees={roster} totalMonthly={totalMonthly} floor={floor} token={token} />
      </div>

      {/* streams table */}
      <div className="dashboard-data-table-wrap sweem-tablecard">
        {roster.length === 0 ? (
          <div className="sweem-gate">No employees with a {symbol} rate yet.</div>
        ) : (
          <table className="sweem-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Wallet</th>
                <th>Monthly</th>
                <th>Status</th>
                <th>Streamed to date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((e) => {
                const status = statusByEmployee[e.walletAddress];
                // A stream row only exists on-chain once this employee's stream
                // was actually started. Someone added mid-stream has no row yet.
                const hasStream = !!status;
                const paused = !!status?.paused;
                const stopped = !!status?.stopped;
                const label = !funded || !hasStream
                  ? "Pending"
                  : stopped
                    ? "Stopped"
                    : paused
                      ? "Paused"
                      : "Streaming";
                const badgeClass = !funded || !hasStream
                  ? "sweem-badge-idle"
                  : stopped
                    ? "sweem-badge-stopped"
                    : paused
                      ? "sweem-badge-paused"
                      : "sweem-badge-live";
                return (
                  <tr key={e.id}>
                    <td className="font-medium">{e.alias}</td>
                    <td className="sweem-mono text-xs">{shortAddr(e.walletAddress)}</td>
                    <td className="tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <TokenIcon token={token} size={14} />
                        {monthlyRate(e, symbol).toFixed(2)} {symbol}
                      </span>
                    </td>
                    <td>
                      <span className={`sweem-badge ${badgeClass}`}>{label}</span>
                    </td>
                    <td className="sweem-mono">
                      <span className="inline-flex items-center gap-1">
                        <TokenIcon token={token} size={14} />
                        <LiveTicker
                          baseRaw={byEmployee[e.walletAddress] ?? 0n}
                          rateRaw={toRaw(token, monthlyRate(e, symbol))}
                          periodMs={BigInt(MONTH_MS)}
                          anchorAt={anchorAt}
                          active={funded && hasStream && !paused && !stopped}
                          decimals={token.decimals}
                        />
                        {" "}{symbol}
                      </span>
                    </td>
                    <td>
                      {funded && !hasStream ? (
                        <ActionButton
                          variant="primary"
                          onClick={() => handleStartStream(e)}
                          disabled={busy}
                        >
                          Start stream
                        </ActionButton>
                      ) : funded && hasStream && !stopped ? (
                        <ActionButton
                          onClick={() => handleToggleStream(e.walletAddress, paused)}
                          disabled={busy}
                        >
                          {paused ? "Resume" : "Pause"}
                        </ActionButton>
                      ) : (
                        <span className="sweem-hint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* invest dialog */}
      <Modal
        open={investOpen}
        onClose={() => setInvestOpen(false)}
        title="Invest idle pool funds"
        subtitle={
          <>
            Earn yield on the portion of the pool not reserved for the next week of
            streams. Investable now: {investable.toFixed(2)} {symbol} (coverage floor{" "}
            {coverageFloor.toFixed(2)} {symbol}).
          </>
        }
        footer={
          <>
            <ActionButton onClick={() => setInvestOpen(false)}>Skip</ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleConfirmInvest}
              disabled={busy || !!validationError}
            >
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
            apy={apyOf(p.key)}
            checked={!!checkedByKey[p.key]}
            onChecked={(v) => setCheckedByKey((prev) => ({ ...prev, [p.key]: v }))}
            amount={amountByKey[p.key] ?? ""}
            onAmount={(v) => setAmountByKey((prev) => ({ ...prev, [p.key]: v }))}
            symbol={symbol}
            max={investable}
          />
        ))}
        {usdyChecked && (
          <SlippageInput bps={slippageBps} onBps={setSlippageBps} disabled={busy} />
        )}
        {validationError && <p className="sweem-error">{validationError}</p>}
      </Modal>

      {/* top-up dialog */}
      <Modal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title="Top up pool"
        subtitle={
          <>
            Add more {symbol} to the pool&apos;s idle balance. A small deposit fee applies; funds
            become available to streams immediately.
          </>
        }
        footer={
          <>
            <ActionButton onClick={() => setTopupOpen(false)}>Cancel</ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleTopup}
              disabled={busy || !(Number(topupAmt) > 0)}
            >
              Top up
            </ActionButton>
          </>
        }
      >
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[var(--sw-text-muted)]">
            Amount ({symbol})
          </label>
          <input
            className="sweem-input w-full"
            type="number"
            inputMode="decimal"
            value={topupAmt}
            onChange={(e) => setTopupAmt(e.target.value)}
            placeholder="0"
          />
        </div>
      </Modal>

      {/* rebalance dialog */}
      <Modal
        open={rebalanceOpen}
        onClose={() => setRebalanceOpen(false)}
        title="Rebalance pool"
        subtitle={<>Move funds between idle cash and your Navi / Scallop / Suilend / Ondo USDY positions.</>}
        footer={
          <>
            <ActionButton onClick={() => setRebalanceOpen(false)}>Cancel</ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleRebalance}
              disabled={busy || rbAmtNum <= 0 || !!rebalanceError}
            >
              Rebalance
            </ActionButton>
          </>
        }
      >
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[var(--sw-text-muted)]">From</p>
          <BucketPicker
            value={rbFrom}
            exclude={rbTo}
            balances={balances}
            symbol={symbol}
            onChange={(b) => {
              setRbFrom(b);
              if (b === rbTo) setRbTo(BUCKETS.find((x) => x.key !== b)!.key);
            }}
          />
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[var(--sw-text-muted)]">To</p>
          <BucketPicker
            value={rbTo}
            exclude={rbFrom}
            balances={balances}
            symbol={symbol}
            onChange={(b) => {
              setRbTo(b);
              if (b === rbFrom) setRbFrom(BUCKETS.find((x) => x.key !== b)!.key);
            }}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[var(--sw-text-muted)]">
            Amount ({symbol})
          </label>
          <input
            className="sweem-input w-full"
            type="number"
            inputMode="decimal"
            value={rbAmt}
            onChange={(e) => setRbAmt(e.target.value)}
            placeholder="0"
          />
          <div className="mt-2 flex justify-end">
            <PercentChips max={balances[rbFrom]} onPick={(v) => setRbAmt(String(v))} />
          </div>
        </div>
        {rbUsesUsdy && (
          <SlippageInput bps={slippageBps} onBps={setSlippageBps} disabled={busy} />
        )}
        {rebalanceError && <p className="sweem-error">{rebalanceError}</p>}
      </Modal>
    </DashboardPageShell>
  );
}
