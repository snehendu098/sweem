"use client";

import { useState } from "react";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  MONTH_MS,
  NAVI_MIN_INVEST_USDC,
  toRaw,
  fromRaw,
  weeklyCommitRaw,
} from "@/lib/sweem";
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
      {/* control card */}
      <div className="sweem-card mt-5 mb-5">
        <div className="sweem-card-head">
          <div>
            <p className="sweem-card-title">
              {funded ? "Streaming live" : "Ready to fund"}
            </p>
            <p className="sweem-card-sub">
              {roster.length} employee(s) · {totalMonthly.toFixed(2)} USDC / month
            </p>
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
        <div className="sweem-metric-row">
          <div>
            <div className="dashboard-metric-label">Monthly payroll</div>
            <div className="dashboard-metric-value">
              {totalMonthly.toFixed(2)} <span className="sweem-metric-unit">USDC</span>
            </div>
          </div>
          <div>
            <div className="dashboard-metric-label">Idle (liquid)</div>
            <div className="dashboard-metric-value">
              {idleUsdc.toFixed(2)} <span className="sweem-metric-unit">USDC</span>
            </div>
          </div>
          <div>
            <div className="dashboard-metric-label">Coverage floor</div>
            <div className="dashboard-metric-value">
              {floorUsdc.toFixed(2)} <span className="sweem-metric-unit">USDC/wk</span>
            </div>
          </div>
        </div>
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
                const paused = !!st?.paused;
                const stopped = !!st?.stopped;
                const status = !funded
                  ? "Pending"
                  : stopped
                    ? "Stopped"
                    : paused
                      ? "Paused"
                      : "Streaming";
                const badgeClass = !funded
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
                        active={funded && !paused && !stopped}
                      />
                    </td>
                    <td>
                      {funded && !stopped ? (
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
