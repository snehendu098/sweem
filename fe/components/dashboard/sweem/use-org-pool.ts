"use client";

import { useMemo } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";

import { useSweemApi } from "@/lib/api";
import { fromRaw } from "@/lib/sweem";
import {
  readPoolSummary,
  readPoolInvestments,
  readClaimable,
  readStreamStatuses,
} from "@/lib/tx";
import { monthlyRate } from "./helpers";

// Shared org + on-chain pool state, used by the Overview and Payroll screens so
// the query logic lives in one place. Mirrors the polling cadence in
// client-test's Org.tsx (pools 8s, pool state 5s).
export function useOrgPool() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const client = useSuiClient();

  const org = api.orgQuery.data;
  const employees = api.employeesQuery.data ?? [];
  const groups = api.groupsQuery.data ?? [];

  const totalMonthly = useMemo(
    () => employees.reduce((s, e) => s + monthlyRate(e), 0),
    [employees],
  );

  const poolsQuery = useQuery({
    queryKey: ["pools", wallet],
    queryFn: () => api.listPools(wallet!),
    enabled: !!wallet && !!org,
    refetchInterval: 8000,
  });
  const onChainPoolId = poolsQuery.data?.find((p) => p.token === "USDC")?.onChainPoolId;

  const empAddrs = employees.map((e) => e.walletAddress);
  const poolState = useQuery({
    queryKey: ["poolState", onChainPoolId, empAddrs.join(",")],
    enabled: !!onChainPoolId,
    refetchInterval: 5000,
    queryFn: async () => {
      const id = onChainPoolId!;
      const [summary, inv, claimables, statusByEmployee] = await Promise.all([
        readPoolSummary(client, id),
        readPoolInvestments(client, id),
        Promise.all(empAddrs.map((a) => readClaimable(client, id, a).catch(() => 0n))),
        readStreamStatuses(client, id, empAddrs).catch(
          () => ({}) as Record<string, { paused: boolean; stopped: boolean }>,
        ),
      ]);
      const accruedRaw = claimables.reduce((s, c) => s + c, 0n);
      const byEmployee: Record<string, bigint> = {};
      empAddrs.forEach((a, i) => {
        byEmployee[a] = claimables[i];
      });
      return { summary, inv, accruedRaw, byEmployee, statusByEmployee };
    },
  });

  const s = poolState.data;
  const funded = s ? s.summary.totalDepositedRaw > 0n : false;
  const idleUsdc = s ? fromRaw(s.summary.idleRaw) : 0;
  const naviUsdc = s ? fromRaw(s.inv.naviRaw) : 0;
  const scallopUsdc = s ? fromRaw(s.inv.scallopRaw) : 0;
  const totalInPool = idleUsdc + naviUsdc + scallopUsdc;
  const streamedBaseRaw = s ? s.summary.totalClaimedRaw + s.accruedRaw : 0n;
  const weeklyRaw = s ? s.summary.weeklyCommittedRaw : 0n;
  const floorUsdc = s ? fromRaw(s.summary.weeklyCommittedRaw) : 0;

  return {
    wallet,
    api,
    client,
    org,
    employees,
    groups,
    totalMonthly,
    poolsQuery,
    onChainPoolId,
    poolState,
    // derived
    funded,
    idleUsdc,
    naviUsdc,
    scallopUsdc,
    totalInPool,
    streamedBaseRaw,
    weeklyRaw,
    floorUsdc,
    anchorAt: poolState.dataUpdatedAt,
  };
}
