"use client";

import { useState } from "react";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  Cell,
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

import {
  MONTH_MS,
  NAVI_MIN_INVEST_USDC,
  toRaw,
  fromRaw,
  weeklyCommitRaw,
} from "@/lib/sweem";
import type { Employee } from "@/lib/api";
import {
  createPoolTx,
  depositTx,
  findCreatedPoolId,
  investNaviTx,
  investScallopTx,
  pauseStreamTx,
  poolHasNaviCap,
  resumeStreamTx,
  type EmployeeStream,
} from "@/lib/tx";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { useOrgPool } from "./use-org-pool";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, ProtocolRow, ConnectGate } from "./ui";
import { monthlyRate, shortAddr } from "./helpers";

const ALLOC = [
  { key: "idle", label: "Idle (liquid)", color: "var(--sw-text)" },
  { key: "navi", label: "Navi", color: "var(--sw-mint)" },
  { key: "scallop", label: "Scallop", color: "var(--sw-lavender)" },
] as const;

function ChartTooltip({
  active,
  payload,
  suffix = "",
}: {
  active?: boolean;
  payload?: { name?: string; payload: { name?: string; label?: string; value: number } }[];
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">
        {p.label ?? p.name}
      </p>
      <p className="text-[13px] font-semibold text-white">
        ${p.value.toFixed(2)}
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
}: {
  total: number;
  idle: number;
  navi: number;
  scallop: number;
}) {
  const mounted = useMounted();
  const values: Record<string, number> = { idle, navi, scallop };
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
              {slices.length > 0 && <Tooltip content={<ChartTooltip />} />}
            </PieChart>
          </ResponsiveContainer>
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <MoneyValue value={total} className="text-[24px] leading-none" />
          <span className="mt-1 text-[11px] text-[var(--sw-text-dim)]">in pool</span>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2.5">
        {ALLOC.map((s) => (
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

// Where idle funds are deployed: one progress bar per protocol, sized vs the pool.
function InvestedCard({
  total,
  idle,
  navi,
  scallop,
}: {
  total: number;
  idle: number;
  navi: number;
  scallop: number;
}) {
  const invested = navi + scallop;
  const sum = total > 0 ? total : 1;
  const rows = [
    { label: "Navi", value: navi, color: "var(--sw-mint)" },
    { label: "Scallop", value: scallop, color: "var(--sw-lavender)" },
  ];

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center gap-3">
        <IconChip>
          <Coins className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Invested in protocols</CardLabel>
      </div>
      <MoneyValue value={invested} className="mt-3 text-[26px] leading-none" />
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Idle funds earning yield · ${idle.toFixed(2)} still liquid
      </p>

      <div className="mt-5 flex flex-1 flex-col justify-center gap-4">
        {rows.map((r) => {
          const pct = (r.value / sum) * 100;
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full" style={{ background: r.color }} />
                  <span className="text-[var(--sw-text-muted)]">{r.label}</span>
                </span>
                <span className="font-semibold tabular-nums text-[var(--sw-text)]">
                  ${r.value.toFixed(2)}
                  <span className="ml-1.5 text-[11.5px] font-medium text-[var(--sw-text-dim)]">
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
}: {
  employees: Employee[];
  totalMonthly: number;
  floor: number;
}) {
  const mounted = useMounted();
  const data = employees
    .map((e) => ({ name: e.alias, label: e.alias, value: monthlyRate(e) }))
    .filter((d) => d.value > 0)
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
        <MoneyValue value={totalMonthly} className="text-[20px] leading-none" />
      </div>

      <div className="mt-3 h-[168px] w-full flex-1">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
            No active streams yet.
          </div>
        ) : mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
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
                content={<ChartTooltip suffix="/mo" />}
              />
              <Bar dataKey="value" radius={[8, 8, 8, 8]} maxBarSize={26} animationDuration={900}>
                {data.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? "var(--sw-mint)" : "var(--sw-lavender)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : null}
      </div>
      <p className="mt-3 text-[12.5px] text-[var(--sw-text-dim)]">
        Coverage floor · {floor.toFixed(2)} USDC/wk reserved
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
    totalMonthly,
    onChainPoolId,
    poolState,
    funded,
    idleUsdc,
    naviUsdc,
    scallopUsdc,
    totalInPool,
    floorUsdc,
    anchorAt,
  } = useOrgPool();
  const qc = useQueryClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [busy, setBusy] = useState(false);

  // invest dialog state
  const [investOpen, setInvestOpen] = useState(false);
  const [poolId, setPoolId] = useState("");
  const [investableUsdc, setInvestableUsdc] = useState(0);
  const [coverageFloor, setCoverageFloor] = useState(0);
  const [naviYes, setNaviYes] = useState(true);
  const [scallopYes, setScallopYes] = useState(true);
  const [naviAmt, setNaviAmt] = useState("");
  const [scallopAmt, setScallopAmt] = useState("");

  const quotes = api.yieldsQuery.data?.quotes ?? [];
  const naviApy = quotes.find((q) => q.protocol === "NAVI")?.apy;
  const scallopApy = quotes.find((q) => q.protocol === "SCALLOP")?.apy;

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
      let createdPoolId = pools.find((p) => p.token === "USDC")?.onChainPoolId;

      if (!createdPoolId) {
        toast.loading("Creating stream pool…", { id: t });
        const { digest } = await signAndExecute({ transaction: createPoolTx(1) });
        const res = await client.waitForTransaction({
          digest,
          options: { showObjectChanges: true, showEffects: true },
        });
        const created = findCreatedPoolId(res.objectChanges);
        if (!created) throw new Error("Could not find created pool id");
        createdPoolId = created;
        await api.createPool(wallet, created);
      }

      const roster: EmployeeStream[] = employees
        .filter((e) => monthlyRate(e) > 0)
        .map((e) => ({
          address: e.walletAddress,
          rateRaw: toRaw(monthlyRate(e)),
          periodMs: BigInt(MONTH_MS),
        }));
      if (roster.length === 0) throw new Error("No employees with a USDC rate");

      toast.loading("Funding pool & starting streams…", { id: t });
      const dep = await signAndExecute({
        transaction: depositTx(createdPoolId, toRaw(totalMonthly), roster),
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
      await poolState.refetch();

      // open invest dialog
      setPoolId(createdPoolId);
      setInvestableUsdc(Math.max(0, totalMonthly - fromRaw(floorRaw)));
      setCoverageFloor(fromRaw(floorRaw));
      setNaviAmt("");
      setScallopAmt("");
      await api.yieldsQuery.refetch();
      toast.success("Pool funded — streams live", { id: t });
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
    setInvestableUsdc(Math.max(0, idleUsdc - floorUsdc));
    setCoverageFloor(floorUsdc);
    setNaviAmt("");
    setScallopAmt("");
    setInvestOpen(true);
  }

  const naviNum = Number(naviAmt) || 0;
  const scallopNum = Number(scallopAmt) || 0;
  const validationError = (() => {
    if (naviYes) {
      if (naviNum > investableUsdc) return "Navi amount exceeds investable balance";
      if (naviNum < NAVI_MIN_INVEST_USDC)
        return `Navi requires at least ${NAVI_MIN_INVEST_USDC} USDC`;
    }
    if (scallopYes && scallopNum > investableUsdc)
      return "Scallop amount exceeds investable balance";
    if (naviYes && scallopYes && naviNum + scallopNum > investableUsdc)
      return "Combined amount exceeds investable balance";
    if (!naviYes && !scallopYes) return "Select at least one protocol";
    return null;
  })();

  async function handleConfirmInvest() {
    if (!poolId || validationError) return;
    setBusy(true);
    const t = toast.loading("Investing idle funds…");
    try {
      if (naviYes && naviNum > 0) {
        const needsCap = !(await poolHasNaviCap(client, poolId));
        toast.loading("Investing into Navi…", { id: t });
        const r = await signAndExecute({
          transaction: investNaviTx(poolId, toRaw(naviNum), { needsCap }),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
      if (scallopYes && scallopNum > 0) {
        toast.loading("Investing into Scallop…", { id: t });
        const r = await signAndExecute({
          transaction: investScallopTx(poolId, toRaw(scallopNum)),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
      toast.success("Idle funds invested", { id: t });
      setInvestOpen(false);
      await poolState.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ── start a stream for an employee added after the pool was funded ──────────
  // Reuses `deposit`, which both tops up the pool and creates the stream row
  // (emitting StreamCreated). We deposit one month of this employee's salary so
  // the pool stays above its coverage floor with the new commitment added.
  async function handleStartStream(employee: Employee) {
    if (!onChainPoolId) return;
    const rate = monthlyRate(employee);
    if (rate <= 0) return;
    setBusy(true);
    const t = toast.loading(`Starting stream · funding ${rate.toFixed(2)} USDC…`);
    try {
      const roster = [
        {
          address: employee.walletAddress,
          rateRaw: toRaw(rate),
          periodMs: BigInt(MONTH_MS),
        },
      ];
      const r = await signAndExecute({
        transaction: depositTx(onChainPoolId, toRaw(rate), roster),
      });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await poolState.refetch();
      toast.success(`Stream started for ${employee.alias}`, { id: t });
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
        ? resumeStreamTx(onChainPoolId, employee)
        : pauseStreamTx(onChainPoolId, employee);
      const r = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true },
      });
      await poolState.refetch();
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

  const roster = employees.filter((e) => monthlyRate(e) > 0);
  const byEmployee = poolState.data?.byEmployee ?? {};
  const statusByEmployee = poolState.data?.statusByEmployee ?? {};

  return (
    <DashboardPageShell
      title="Payroll"
      subtitle={
        funded
          ? "Streams are live. Invest idle funds to earn yield while salary streams."
          : "Fund the pool to start streaming salaries per millisecond."
      }
    >
      {/* header: status + primary action */}
      <div className="mt-5 mb-4 flex flex-wrap items-end justify-between gap-3">
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
              {roster.length} employee(s) · {totalMonthly.toFixed(2)} USDC / month
            </p>
          </div>
        </div>
        {funded ? (
          <ActionButton
            variant="primary"
            onClick={openInvestMore}
            disabled={busy || idleUsdc <= floorUsdc}
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

      {/* pool / protocol breakdown cards */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PoolBalanceCard total={totalInPool} idle={idleUsdc} navi={naviUsdc} scallop={scallopUsdc} />
        <InvestedCard total={totalInPool} idle={idleUsdc} navi={naviUsdc} scallop={scallopUsdc} />
        <MonthlyPayrollCard employees={roster} totalMonthly={totalMonthly} floor={floorUsdc} />
      </div>

      {/* streams table */}
      <div className="dashboard-data-table-wrap sweem-tablecard">
        {roster.length === 0 ? (
          <div className="sweem-gate">No employees with a USDC rate yet.</div>
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
                const st = statusByEmployee[e.walletAddress];
                // A stream row only exists on-chain once this employee's stream
                // was actually started. Someone added mid-stream has no row yet —
                // so they're not streaming, regardless of the pool-level funded flag.
                const hasStream = !!st;
                const paused = !!st?.paused;
                const stopped = !!st?.stopped;
                const status = !funded || !hasStream
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
                    <td>{monthlyRate(e).toFixed(2)} USDC</td>
                    <td>
                      <span className={`sweem-badge ${badgeClass}`}>{status}</span>
                    </td>
                    <td className="sweem-mono">
                      <LiveTicker
                        baseRaw={byEmployee[e.walletAddress] ?? 0n}
                        rateRaw={toRaw(monthlyRate(e))}
                        periodMs={BigInt(MONTH_MS)}
                        anchorAt={anchorAt}
                        active={funded && hasStream && !paused && !stopped}
                      />
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
            streams. Investable now: {investableUsdc.toFixed(2)} USDC (coverage floor{" "}
            {coverageFloor.toFixed(2)} USDC).
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
        {validationError && <p className="sweem-error">{validationError}</p>}
      </Modal>
    </DashboardPageShell>
  );
}
