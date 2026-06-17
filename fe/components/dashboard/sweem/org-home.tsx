"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { WEEK_MS, fromRaw, EXPLORER_TX } from "@/lib/sweem";
import { readRecentActivity } from "@/lib/tx";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";
import {
  RecentPaymentsTable,
  type RecentRow,
} from "@/components/dashboard/recent-payments-table";
import type { Metric } from "@/components/dashboard/metrics-overview";
import { useOrgPool } from "./use-org-pool";
import { LiveTicker } from "./live-ticker";
import { ActionButton } from "./ui";
import { monthlyRate, shortAddr } from "./helpers";

export function OrgHome() {
  const {
    wallet,
    api,
    client,
    org,
    employees,
    funded,
    idleUsdc,
    naviUsdc,
    scallopUsdc,
    totalInPool,
    streamedBaseRaw,
    weeklyRaw,
    onChainPoolId,
    anchorAt,
  } = useOrgPool();
  const qc = useQueryClient();

  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);

  const rosterCount = employees.filter((e) => monthlyRate(e) > 0).length;

  // ----- recent on-chain activity (best-effort; empty → original empty table) -----
  // Scoped to this org's pool when there is one, else a global Sweem feed so the
  // section still shows real mainnet activity.
  const activityQuery = useQuery({
    queryKey: ["activity", onChainPoolId ?? "all"],
    refetchInterval: 10000,
    queryFn: () => readRecentActivity(client, onChainPoolId ?? null),
  });

  const rows: RecentRow[] | undefined = activityQuery.data?.map((a, i) => ({
    key: `${a.digest}-${i}`,
    cells: [
      a.timestampMs ? new Date(a.timestampMs).toLocaleDateString() : "—",
      `$${fromRaw(a.amountRaw).toFixed(2)}`,
      <span key="s" className="sweem-badge sweem-badge-live">Completed</span>,
      a.kind === "claim" ? "Salary claim" : "Pool funded",
      <span key="p" className="sweem-mono text-xs">{shortAddr(a.party)}</span>,
      a.kind === "claim" ? "Stream" : "Deposit",
      "—",
      <a
        key="a"
        href={EXPLORER_TX(a.digest)}
        target="_blank"
        rel="noreferrer"
        className="text-[color:var(--dash-blue)]"
      >
        View
      </a>,
    ],
  }));

  async function handleCreateOrg() {
    if (!orgName.trim()) return;
    setBusy(true);
    try {
      await api.ensureOrg(orgName.trim());
      toast.success("Organization created");
      setOrgName("");
      await qc.invalidateQueries({ queryKey: ["org", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const metrics: Metric[] = [
    {
      label: "Total streamed",
      value: funded ? (
        <>
          {"$"}
          <LiveTicker
            baseRaw={streamedBaseRaw}
            rateRaw={weeklyRaw}
            periodMs={BigInt(WEEK_MS)}
            anchorAt={anchorAt}
            active={funded}
          />
        </>
      ) : (
        "$0"
      ),
    },
    { label: "Active streams", value: String(rosterCount) },
  ];

  const volumeRows: [string, string][] = [
    ["Total in pool", `$${totalInPool.toFixed(2)}`],
    ["Idle (liquid)", `$${idleUsdc.toFixed(2)}`],
    ["Earning yield", `$${(naviUsdc + scallopUsdc).toFixed(2)}`],
  ];

  const showCreateOrg = !!wallet && !api.orgQuery.isLoading && !org;

  return (
    <section className="dashboard-content">
      <h1 className="dashboard-title">Today</h1>

      {showCreateOrg && (
        <div className="sweem-card mb-2 max-w-xl">
          <p className="sweem-card-title">Create your organization</p>
          <p className="sweem-card-sub mb-3">
            Onboard your org to start streaming payroll on Sui mainnet.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="sweem-label">Organization name</label>
              <input
                className="sweem-input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
              />
            </div>
            <ActionButton variant="primary" onClick={handleCreateOrg} disabled={busy || !orgName.trim()}>
              Create organization
            </ActionButton>
          </div>
        </div>
      )}

      <div className="dashboard-card-grid">
        <DashboardCard
          icon="link"
          title="Fund payroll"
          description="Fund the pool and start streaming salaries per second."
          href="/dashboard/payments"
          primaryAction="Fund"
          secondaryAction="View"
        />
        <DashboardCard
          icon="invoice"
          title="Add employees"
          description="Add team members and set each one's monthly USDC rate."
          href="/dashboard/customers"
          primaryAction="Add"
          secondaryAction="View"
        />
        <DashboardCard
          icon="code"
          title="Employee portal"
          description="Where employees claim streamed pay and earn vault yield."
          href="/dashboard/portal"
          secondaryAction="Open"
        />
      </div>

      <AnalyticsSection
        metrics={metrics}
        volumeTitle="Pool balance"
        volumeRows={volumeRows}
        volumeNote="Balances in USDC"
      />

      <RecentPaymentsTable rows={rows} />
    </section>
  );
}
