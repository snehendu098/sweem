"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ConnectModal } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  ArrowUpRight,
  ChevronRight,
  Coins,
  Receipt,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

import type { Employee, YieldQuote } from "@/lib/api";
import { WEEK_MS, EXPLORER_TX } from "@/lib/sweem";
import { TOKENS, fromRaw, type TokenConfig, type TokenSymbol } from "@/lib/tokens";
import { readRecentActivity, type ActivityRow } from "@/lib/tx";
import {
  CardLabel,
  IconChip,
  MoneyValue,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { Column, DashboardGrid } from "@/components/sweem-ui/dashboard-grid";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { useOrgPool } from "./use-org-pool";
import { TokenTabs } from "./token-tabs";
import { LiveTicker } from "./live-ticker";
import { monthlyRate, shortAddr } from "./helpers";

export function OrgHome() {
  const {
    wallet,
    api,
    client,
    org,
    employees,
    poolStateByToken,
    poolIdByToken,
    totalMonthlyByToken,
    anchorAt,
  } = useOrgPool();

  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const token = TOKENS[symbol];
  const st = poolStateByToken[symbol];
  const totalMonthly = totalMonthlyByToken[symbol];
  const poolId = poolIdByToken[symbol];

  const rosterCount = employees.filter((e) => monthlyRate(e, symbol) > 0).length;
  const earningYield = st.navi + st.scallop + st.suilend + st.usdy;

  const activityQuery = useQuery({
    queryKey: ["activity", symbol, poolId ?? "all"],
    refetchInterval: 10000,
    queryFn: () => readRecentActivity(client, poolId ?? null, 8, [token]),
  });

  const router = useRouter();
  const showConnect = !wallet;
  // Wallet connected but no org → send to onboarding. Fires only while unregistered.
  const needsOnboarding = !!wallet && !api.orgQuery.isLoading && !org;

  useEffect(() => {
    if (needsOnboarding) router.push("/onboarding");
  }, [needsOnboarding, router]);

  return (
    <div className="dashboard-content">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
          {org ? org.name : "Overview"}
        </h1>
        <TokenTabs value={symbol} onChange={setSymbol} />
      </div>

      {showConnect && <ConnectPrompt />}
      {needsOnboarding && (
        <div className="mb-4 rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 text-[13px] text-[var(--sw-text-muted)]">
          Taking you to setup…
        </div>
      )}

      <DashboardGrid>
        {/* Left */}
        <Column className="lg:col-span-3">
          <StatCard
            icon={<Wallet className="size-[18px]" strokeWidth={2} />}
            label="Total in Pool"
            value={st.totalInPool}
            token={token}
            caption="Idle + earning yield"
          />
          <NumberStatCard
            icon={<Users className="size-[18px]" strokeWidth={2} />}
            label="Active Streams"
            value={rosterCount}
            caption={
              <span className="inline-flex items-center gap-1">
                {totalMonthly.toFixed(2)}
                <TokenIcon token={token} size={13} />
                {symbol} / month committed
              </span>
            }
          />
          <CompositionCard
            idle={st.idle}
            navi={st.navi}
            scallop={st.scallop}
            suilend={st.suilend}
            usdy={st.usdy}
            total={st.totalInPool}
            token={token}
          />
        </Column>

        {/* Center */}
        <Column className="lg:col-span-5">
          <StreamedHeroCard
            funded={st.funded}
            streamedBaseRaw={st.streamedBaseRaw}
            weeklyRaw={st.weeklyRaw}
            anchorAt={anchorAt}
            monthly={totalMonthly}
            token={token}
          />
          <PayrollAnalyticsCard
            employees={employees}
            totalMonthly={totalMonthly}
            token={token}
            className="grow"
          />
        </Column>

        {/* Right */}
        <Column className="lg:col-span-4">
          <RecentActivityCard activity={activityQuery.data} loading={activityQuery.isLoading} />
          <FundPayrollCTA />
          <YieldCard
            earning={earningYield}
            naviAmount={st.navi}
            scallopAmount={st.scallop}
            suilendAmount={st.suilend}
            usdyAmount={st.usdy}
            yields={api.yieldsByToken.data?.[symbol]?.quotes}
            token={token}
            className="grow"
          />
        </Column>
      </DashboardGrid>
    </div>
  );
}

/* ── Gates ────────────────────────────────────────────────────────────── */

function ConnectPrompt() {
  return (
    <div className="mb-4 flex flex-col items-start gap-4 rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <IconChip className="size-11">
          <Wallet className="size-5" strokeWidth={2} />
        </IconChip>
        <div>
          <p className="text-[15px] font-semibold text-[var(--sw-text)]">Connect your wallet</p>
          <p className="text-[13px] text-[var(--sw-text-muted)]">
            Connect a Sui wallet to manage your organization and payroll streams.
          </p>
        </div>
      </div>
      <ConnectModal
        trigger={
          <button className="rounded-full bg-[var(--sw-mint)] px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f]">
            Connect wallet
          </button>
        }
      />
    </div>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  token,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  token: TokenConfig;
  caption: string;
}) {
  return (
    <SweemCard className="flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="mt-7">
        <MoneyValue value={value} token={token} className="text-[30px] leading-none" />
        <p className="mt-2 text-[12.5px] text-[var(--sw-text-dim)]">{caption}</p>
      </div>
    </SweemCard>
  );
}

function NumberStatCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  caption: React.ReactNode;
}) {
  return (
    <SweemCard className="flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="mt-7">
        <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        <p className="mt-2 text-[12.5px] text-[var(--sw-text-dim)]">{caption}</p>
      </div>
    </SweemCard>
  );
}

const COMPOSITION = [
  { key: "idle", label: "Idle (liquid)", color: "var(--sw-text)" },
  { key: "navi", label: "Navi", color: "var(--sw-mint)" },
  { key: "scallop", label: "Scallop", color: "var(--sw-lavender)" },
  { key: "suilend", label: "Suilend", color: "#6bb8f5" },
  { key: "usdy", label: "USDY", color: "#f5c46b" },
] as const;

function CompositionCard({
  idle,
  navi,
  scallop,
  suilend,
  usdy,
  total,
  token,
  className,
}: {
  idle: number;
  navi: number;
  scallop: number;
  suilend: number;
  usdy: number;
  total: number;
  token: TokenConfig;
  className?: string;
}) {
  const values: Record<string, number> = { idle, navi, scallop, suilend, usdy };
  const sum = total > 0 ? total : 1;

  return (
    <SweemCard className={`flex flex-col ${className ?? ""}`}>
      <CardLabel className="text-[15px] text-[var(--sw-text)]">Pool Composition</CardLabel>
      <div className="mt-4 flex h-[26px] items-stretch gap-1.5">
        {COMPOSITION.map((seg, i) => (
          <motion.span
            key={seg.key}
            initial={{ flexGrow: 0, opacity: 0 }}
            animate={{ flexGrow: Math.max(values[seg.key] / sum, total > 0 ? 0 : 0.33), opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.1, type: "spring", stiffness: 200, damping: 24 }}
            style={{ flexBasis: 0, background: seg.color }}
            className="rounded-full"
          />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-3.5">
        {COMPOSITION.map((seg) => (
          <li key={seg.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <ProtocolLogo name={seg.label} size={18} accent={seg.color} />
              <span className="text-[13px] text-[var(--sw-text-muted)]">{seg.label}</span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text)]">
              {values[seg.key].toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </SweemCard>
  );
}

function StreamedHeroCard({
  funded,
  streamedBaseRaw,
  weeklyRaw,
  anchorAt,
  monthly,
  token,
}: {
  funded: boolean;
  streamedBaseRaw: bigint;
  weeklyRaw: bigint;
  anchorAt: number;
  monthly: number;
  token: TokenConfig;
}) {
  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-start justify-between">
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Total Streamed</CardLabel>
        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(196,245,107,0.14)] px-2 py-1 text-[12px] font-semibold text-[var(--sw-mint)]">
          <span className={funded ? "size-1.5 rounded-full bg-[var(--sw-mint)]" : "size-1.5 rounded-full bg-[var(--sw-text-dim)]"} />
          {funded ? "Streaming live" : "Idle"}
        </span>
      </div>

      <div className="mt-7 flex items-center font-semibold tracking-[-0.02em] tabular-nums">
        <TokenIcon token={token} size={32} className="mr-2" />
        <span className="text-[40px] leading-none">
          {funded ? (
            <LiveTicker
              baseRaw={streamedBaseRaw}
              rateRaw={weeklyRaw}
              periodMs={BigInt(WEEK_MS)}
              anchorAt={anchorAt}
              active={funded}
              decimals={token.decimals}
            />
          ) : (
            "0.00"
          )}
        </span>
      </div>
      <p className="mt-2.5 text-[13px] text-[var(--sw-text-muted)]">
        {monthly.toFixed(2)} {token.symbol} / month committed across all streams
      </p>

      {/* Decorative equalizer */}
      <div className="mt-6 flex h-12 items-end justify-between">
        {Array.from({ length: 46 }).map((_, i) => {
          const h = 0.4 + 0.4 * Math.abs(Math.sin(i * 0.9 + 0.5)) + 0.18 * Math.abs(Math.cos(i * 0.37));
          return (
            <motion.span
              key={i}
              initial={{ height: "10%", opacity: 0 }}
              animate={{ height: `${Math.min(1, h) * 100}%`, opacity: 1 }}
              transition={{ delay: 0.35 + i * 0.01, type: "spring", stiffness: 220, damping: 18 }}
              className={`w-[4px] rounded-full ${i < 25 ? "bg-[var(--sw-mint)]" : "bg-[var(--sw-lavender)]"}`}
            />
          );
        })}
      </div>
    </SweemCard>
  );
}

function PayrollAnalyticsCard({
  employees,
  totalMonthly,
  token,
  className,
}: {
  employees: Employee[];
  totalMonthly: number;
  token: TokenConfig;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const data = employees
    .map((e) => ({ name: e.alias, value: monthlyRate(e, token.symbol) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return (
    <SweemCard className={`flex flex-col ${className ?? ""}`}>
      <div className="flex items-start justify-between">
        <div>
          <CardLabel className="text-[15px] text-[var(--sw-text)]">Monthly Payroll</CardLabel>
          <div className="mt-2">
            <MoneyValue value={totalMonthly} token={token} className="text-[26px] leading-none" />
          </div>
        </div>
        <span className="rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[12px] text-[var(--sw-text-muted)]">
          Per employee
        </span>
      </div>

      <div className="mt-4 h-[200px] w-full flex-1">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
            Add employees to see the payroll breakdown.
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
                content={<PayrollTooltip symbol={token.symbol} />}
              />
              <Bar dataKey="value" radius={[8, 8, 8, 8]} maxBarSize={42} animationDuration={900} animationBegin={150}>
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
    </SweemCard>
  );
}

function PayrollTooltip({
  active,
  payload,
  symbol,
}: {
  active?: boolean;
  payload?: { payload: { name: string; value: number } }[];
  symbol?: string;
}) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">{name}</p>
      <p className="text-[13px] font-semibold text-white">{value.toFixed(2)} {symbol}/mo</p>
    </div>
  );
}

function RecentActivityCard({
  activity,
  loading,
}: {
  activity?: ActivityRow[];
  loading: boolean;
}) {
  const rows = (activity ?? []).slice(0, 4);

  return (
    <SweemCard className="flex flex-col">
      <CardLabel className="text-[15px] text-[var(--sw-text)]">Recent Activity</CardLabel>

      {rows.length === 0 ? (
        <div className="mt-4 flex h-[120px] items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
          {loading ? "Loading on-chain activity…" : "No recent activity yet."}
        </div>
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((a, i) => {
            const isClaim = a.kind === "claim";
            return (
              <motion.li
                key={`${a.digest}-${i}`}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.07, type: "spring", stiffness: 240, damping: 24 }}
                className="flex items-center gap-3 border-t border-[var(--sw-border)] py-3 first:border-t-0"
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                    isClaim ? "bg-[rgba(188,174,247,0.14)] text-[var(--sw-lavender)]" : "bg-[rgba(196,245,107,0.14)] text-[var(--sw-mint)]"
                  }`}
                >
                  {isClaim ? <ArrowUpRight className="size-4" strokeWidth={2.2} /> : <Coins className="size-4" strokeWidth={2.2} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-[var(--sw-text)]">
                    {isClaim ? "Salary claim" : "Pool funded"}
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-[var(--sw-text-dim)]">
                    {shortAddr(a.party)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="flex items-center gap-1 text-[13.5px] font-semibold tabular-nums text-[var(--sw-text)]">
                    <TokenIcon token={a.token} size={14} />
                    {fromRaw(a.token, a.amountRaw).toFixed(2)} {a.token.symbol}
                  </span>
                  <a
                    href={EXPLORER_TX(a.digest)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[var(--sw-mint)] hover:underline"
                  >
                    View
                  </a>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </SweemCard>
  );
}

function FundPayrollCTA() {
  return (
    <Link href="/dashboard/payments" className="block">
      <SweemCard accent hover className="flex items-center gap-4 py-4">
        <IconChip tone="dark" className="size-10 bg-black/85 text-[var(--sw-mint)]">
          <Zap className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-black">Fund payroll</p>
          <p className="truncate text-[12.5px] font-medium text-black/65">
            Fund the pool and start streaming salaries per second
          </p>
        </div>
        <ChevronRight className="size-5 text-black/80" strokeWidth={2.4} />
      </SweemCard>
    </Link>
  );
}

function YieldCard({
  earning,
  naviAmount,
  scallopAmount,
  suilendAmount,
  usdyAmount,
  yields,
  token,
  className,
}: {
  earning: number;
  naviAmount: number;
  scallopAmount: number;
  suilendAmount: number;
  usdyAmount: number;
  yields?: YieldQuote[];
  token: TokenConfig;
  className?: string;
}) {
  const navi = yields?.find((y) => y.protocol === "NAVI")?.apy;
  const scallop = yields?.find((y) => y.protocol === "SCALLOP")?.apy;
  const suilend = yields?.find((y) => y.protocol === "SUILEND")?.apy;
  const usdy = yields?.find((y) => y.protocol === "USDY")?.apy;

  return (
    <SweemCard className={`flex flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Earning Yield</CardLabel>
        <Receipt className="size-4 text-[var(--sw-text-dim)]" strokeWidth={2} />
      </div>
      <MoneyValue value={earning} token={token} className="mt-2 text-[26px] leading-none" />
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">Idle funds invested in lending &amp; yield protocols</p>

      <div className="mt-5 grid flex-1 grid-cols-2 gap-3">
        <YieldChip name="Navi" amount={naviAmount} apy={navi} accent="var(--sw-mint)" />
        <YieldChip name="Scallop" amount={scallopAmount} apy={scallop} accent="var(--sw-lavender)" />
        <YieldChip name="Suilend" amount={suilendAmount} apy={suilend} accent="#6bb8f5" />
        <YieldChip name="USDY" amount={usdyAmount} apy={usdy} accent="#f5c46b" />
      </div>
    </SweemCard>
  );
}

function YieldChip({
  name,
  amount,
  apy,
  accent,
}: {
  name: string;
  amount: number;
  apy?: number;
  accent: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <ProtocolLogo name={name} size={18} accent={accent} />
          <span className="text-[12.5px] text-[var(--sw-text-muted)]">{name}</span>
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-[var(--sw-text-muted)]">
          {apy == null ? "—" : `${apy.toFixed(2)}%`}
        </span>
      </div>
      <p className="mt-2 text-[18px] font-semibold tabular-nums text-[var(--sw-text)]">
        {amount.toFixed(2)}
      </p>
      <p className="text-[10.5px] text-[var(--sw-text-dim)]">Invested · {apy == null ? "—" : `${apy.toFixed(2)}% APR`}</p>
    </div>
  );
}
