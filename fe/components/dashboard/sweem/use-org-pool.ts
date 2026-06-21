"use client";

import { useMemo } from "react";
import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";

import { useSweemApi } from "@/lib/api";
import {
  SUPPORTED_TOKENS,
  TOKEN_SYMBOLS,
  TOKENS,
  fromRaw,
  type TokenSymbol,
} from "@/lib/tokens";
import {
  readPoolSummary,
  readPoolInvestments,
  readClaimable,
  readStreamStatuses,
  type PoolSummary,
} from "@/lib/tx";
import { monthlyRate } from "./helpers";

export interface TokenPoolState {
  poolId?: string;
  funded: boolean;
  summary: PoolSummary | null;
  idle: number;
  navi: number;
  scallop: number;
  suilend: number;
  usdy: number; // base-token (T) principal in the USDY position
  usdyHeldY: number; // custodied USDY (Y) balance, for withdraw sizing
  totalInPool: number;
  floor: number;
  weeklyRaw: bigint;
  streamedBaseRaw: bigint;
  accruedRaw: bigint;
  byEmployee: Record<string, bigint>;
  statusByEmployee: Record<string, { paused: boolean; stopped: boolean }>;
}

const emptyState = (poolId?: string): TokenPoolState => ({
  poolId,
  funded: false,
  summary: null,
  idle: 0,
  navi: 0,
  scallop: 0,
  suilend: 0,
  usdy: 0,
  usdyHeldY: 0,
  totalInPool: 0,
  floor: 0,
  weeklyRaw: 0n,
  streamedBaseRaw: 0n,
  accruedRaw: 0n,
  byEmployee: {},
  statusByEmployee: {},
});

// Shared org + on-chain pool state. Reads each token's StreamPool independently and
// returns a per-token map so the Overview and Payroll screens can render any token.
export function useOrgPool() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const client = useSuiClient();

  const org = api.orgQuery.data;
  const employees = useMemo(() => api.employeesQuery.data ?? [], [api.employeesQuery.data]);
  const groups = api.groupsQuery.data ?? [];

  const totalMonthlyByToken = useMemo(() => {
    const out = {} as Record<TokenSymbol, number>;
    for (const symbol of TOKEN_SYMBOLS) {
      out[symbol] = employees.reduce((s, e) => s + monthlyRate(e, symbol), 0);
    }
    return out;
  }, [employees]);

  const poolsQuery = useQuery({
    queryKey: ["pools", wallet],
    queryFn: () => api.listPools(wallet!),
    enabled: !!wallet && !!org,
    refetchInterval: 8000,
  });

  const poolIdByToken = useMemo(() => {
    const out = {} as Record<TokenSymbol, string | undefined>;
    for (const symbol of TOKEN_SYMBOLS) {
      out[symbol] = poolsQuery.data?.find((p) => p.token === symbol)?.onChainPoolId;
    }
    return out;
  }, [poolsQuery.data]);

  const empAddrs = useMemo(() => employees.map((e) => e.walletAddress), [employees]);

  const poolStateQuery = useQuery({
    queryKey: ["poolState", poolIdByToken, empAddrs.join(",")],
    enabled: SUPPORTED_TOKENS.some((t) => !!poolIdByToken[t.symbol]),
    refetchInterval: 5000,
    queryFn: async () => {
      const states = {} as Record<TokenSymbol, TokenPoolState>;
      await Promise.all(
        SUPPORTED_TOKENS.map(async (token) => {
          const id = poolIdByToken[token.symbol];
          if (!id) {
            states[token.symbol] = emptyState();
            return;
          }
          const [summary, inv, claimables, statusByEmployee] = await Promise.all([
            readPoolSummary(client, id),
            readPoolInvestments(client, id),
            Promise.all(empAddrs.map((a) => readClaimable(client, id, a, token).catch(() => 0n))),
            readStreamStatuses(client, id, empAddrs).catch(
              () => ({}) as Record<string, { paused: boolean; stopped: boolean }>,
            ),
          ]);
          const accruedRaw = claimables.reduce((s, c) => s + c, 0n);
          const byEmployee: Record<string, bigint> = {};
          empAddrs.forEach((a, i) => {
            byEmployee[a] = claimables[i];
          });
          const idle = fromRaw(token, summary.idleRaw);
          const navi = fromRaw(token, inv.naviRaw);
          const scallop = fromRaw(token, inv.scallopRaw);
          const suilend = fromRaw(token, inv.suilendRaw);
          const usdy = fromRaw(token, inv.usdyRaw);
          states[token.symbol] = {
            poolId: id,
            funded: summary.totalDepositedRaw > 0n,
            summary,
            idle,
            navi,
            scallop,
            suilend,
            usdy,
            usdyHeldY: fromRaw(token, inv.usdyHeldYRaw),
            totalInPool: idle + navi + scallop + suilend + usdy,
            floor: fromRaw(token, summary.weeklyCommittedRaw),
            weeklyRaw: summary.weeklyCommittedRaw,
            streamedBaseRaw: summary.totalClaimedRaw + accruedRaw,
            accruedRaw,
            byEmployee,
            statusByEmployee,
          };
        }),
      );
      return states;
    },
  });

  const poolStateByToken = useMemo(() => {
    const out = {} as Record<TokenSymbol, TokenPoolState>;
    for (const symbol of TOKEN_SYMBOLS) {
      out[symbol] = poolStateQuery.data?.[symbol] ?? emptyState(poolIdByToken[symbol]);
    }
    return out;
  }, [poolStateQuery.data, poolIdByToken]);

  return {
    wallet,
    api,
    client,
    org,
    employees,
    groups,
    poolsQuery,
    poolStateQuery,
    poolIdByToken,
    poolStateByToken,
    totalMonthlyByToken,
    tokens: SUPPORTED_TOKENS,
    tokenConfig: TOKENS,
    anchorAt: poolStateQuery.dataUpdatedAt,
  };
}
