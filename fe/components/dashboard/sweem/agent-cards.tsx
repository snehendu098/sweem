"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSweemApi } from "@/lib/api";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Loader2,
  Users,
  Zap,
  Info,
  Code2,
  PlayCircle,
  PauseCircle,
  SkipForward,
  Edit3,
  BarChart3,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { cn } from "@/lib/utils";
import { shortAddr } from "./helpers";

// ── Shared card shell ─────────────────────────────────────────────────────────

function AgentCard({
  children,
  className,
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 26 }}
      className={cn(
        "my-2 w-full overflow-hidden rounded-[18px] border",
        accent
          ? "border-[var(--sw-mint)]/40 bg-[var(--sw-mint)]/5"
          : "border-[var(--sw-border)] bg-[var(--sw-card)]",
        "shadow-[0_12px_40px_-20px_rgba(0,0,0,0.7)]",
        className
      )}
    >
      {children}
    </motion.div>
  );
}

function CardHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--sw-border)] px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-text-muted)]">
        {icon}
      </span>
      <div>
        <p className="text-[13px] font-semibold text-[var(--sw-text)]">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-[var(--sw-text-dim)]">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

export function ToolLoadingCard({ label }: { label: string }) {
  return (
    <AgentCard>
      <div className="flex items-center gap-3 px-4 py-3">
        <Loader2 className="size-4 animate-spin text-[var(--sw-text-dim)]" />
        <span className="text-[13px] text-[var(--sw-text-muted)]">{label}</span>
      </div>
    </AgentCard>
  );
}

// ── Employee list card ────────────────────────────────────────────────────────

interface EmployeeRow {
  id: string;
  alias: string;
  walletAddress: string;
  groupName?: string | null;
  rates: Array<{ token: string; rateAmount: string; rateType: string }>;
}

export function EmployeeListCard({
  data,
}: {
  data: { employees: EmployeeRow[]; count: number };
}) {
  return (
    <AgentCard>
      <CardHeader
        icon={<Users className="size-4" strokeWidth={2} />}
        title={`${data.count} Employee${data.count !== 1 ? "s" : ""}`}
        subtitle="Current payroll roster"
      />
      <div className="divide-y divide-[var(--sw-border)]">
        {data.employees.map((emp) => {
          const rateStr = emp.rates
            .map(
              (r) =>
                `${Number(r.rateAmount).toLocaleString()} ${r.token}/${r.rateType === "MONTHLY" ? "mo" : "hr"}`
            )
            .join(" · ");
          return (
            <div
              key={emp.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--sw-mint)]/15 text-[10px] font-bold text-[var(--sw-mint)]">
                  {emp.alias.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-[13px] font-medium text-[var(--sw-text)]">
                    {emp.alias}
                  </p>
                  <p className="text-[11px] text-[var(--sw-text-dim)]">
                    {shortAddr(emp.walletAddress)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                {emp.groupName && (
                  <p className="text-[11px] text-[var(--sw-text-dim)]">
                    {emp.groupName}
                  </p>
                )}
                <p className="text-[12px] font-medium tabular-nums text-[var(--sw-text-muted)]">
                  {rateStr || "No rates"}
                </p>
              </div>
            </div>
          );
        })}
        {data.employees.length === 0 && (
          <p className="px-4 py-3 text-[13px] text-[var(--sw-text-dim)]">
            No employees found.
          </p>
        )}
      </div>
    </AgentCard>
  );
}

// ── Payroll chart card ────────────────────────────────────────────────────────

const CHART_COLORS = [
  "var(--sw-mint)",
  "var(--sw-lavender)",
  "#7dd3fc",
  "#fca5a5",
  "#fcd34d",
];

export function PayrollChartCard({
  data,
}: {
  data: {
    chartData: Array<{ name: string; count: number; monthlyUSDC: number; monthlySUI: number }>;
    totals: { employeeCount: number; monthlyUSDC: number; monthlySUI: number };
  };
}) {
  const [token, setToken] = useState<"USDC" | "SUI">("USDC");
  const key = token === "USDC" ? "monthlyUSDC" : "monthlySUI";
  const total = data.totals[key === "monthlyUSDC" ? "monthlyUSDC" : "monthlySUI"];

  return (
    <AgentCard>
      <CardHeader
        icon={<BarChart3 className="size-4" strokeWidth={2} />}
        title="Payroll Breakdown"
        subtitle={`${data.totals.employeeCount} employees across ${data.chartData.length} groups`}
      />
      {/* Token selector */}
      <div className="flex gap-1 border-b border-[var(--sw-border)] px-4 py-2">
        {(["USDC", "SUI"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setToken(t)}
            className={cn(
              "rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors",
              token === t
                ? "bg-[var(--sw-mint)] text-black"
                : "text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
            )}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-[12px] tabular-nums text-[var(--sw-text-muted)]">
          {total.toLocaleString()} {token}/mo
        </span>
      </div>
      <div className="px-4 pb-4 pt-3">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.chartData} barSize={28}>
            <XAxis
              dataKey="name"
              tick={{ fill: "var(--sw-text-dim)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--sw-card)",
                border: "1px solid var(--sw-border)",
                borderRadius: 12,
                color: "var(--sw-text)",
                fontSize: 12,
              }}
              formatter={(v) => [`${Number(v ?? 0).toLocaleString()} ${token}`, "Monthly"]}
            />
            <Bar dataKey={key} radius={[6, 6, 0, 0]}>
              {data.chartData.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </AgentCard>
  );
}

// ── Protocol info card ────────────────────────────────────────────────────────

export function ProtocolInfoCard({
  data,
}: {
  data: { protocol: string; blockchain: string; features: string[]; topic: string };
}) {
  return (
    <AgentCard>
      <CardHeader
        icon={<Info className="size-4" strokeWidth={2} />}
        title={data.protocol}
        subtitle={data.blockchain}
      />
      <ul className="divide-y divide-[var(--sw-border)]">
        {data.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 px-4 py-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--sw-mint)]" strokeWidth={2.5} />
            <span className="text-[13px] text-[var(--sw-text-muted)]">{f}</span>
          </li>
        ))}
      </ul>
    </AgentCard>
  );
}

// ── SDK coming soon card ──────────────────────────────────────────────────────

export function SdkInfoCard() {
  return (
    <AgentCard>
      <CardHeader
        icon={<Code2 className="size-4" strokeWidth={2} />}
        title="Developer SDK"
        subtitle="Coming soon"
      />
      <div className="px-4 py-3">
        <p className="text-[13px] text-[var(--sw-text-muted)]">
          TypeScript client SDK, Move ABIs, webhook integrations, and REST API docs are on the way.
        </p>
      </div>
    </AgentCard>
  );
}

// ── Action confirm card ───────────────────────────────────────────────────────

export type PendingAction =
  | { type: "pendingAction"; action: "addEmployee"; data: Record<string, unknown>; summary: string }
  | { type: "pendingAction"; action: "bulkAdd"; data: unknown[]; summary: string }
  | { type: "pendingAction"; action: "pauseStream"; data: Record<string, unknown>; summary: string }
  | { type: "pendingAction"; action: "resumeStream"; data: Record<string, unknown>; summary: string }
  | { type: "pendingAction"; action: "startStream"; data: Record<string, unknown>; summary: string }
  | { type: "pendingAction"; action: "editEmployee"; data: Record<string, unknown>; summary: string };

const ACTION_ICONS: Record<PendingAction["action"], React.ReactNode> = {
  addEmployee: <Zap className="size-4" strokeWidth={2} />,
  bulkAdd: <Users className="size-4" strokeWidth={2} />,
  pauseStream: <PauseCircle className="size-4" strokeWidth={2} />,
  resumeStream: <PlayCircle className="size-4" strokeWidth={2} />,
  startStream: <SkipForward className="size-4" strokeWidth={2} />,
  editEmployee: <Edit3 className="size-4" strokeWidth={2} />,
};

const ACTION_LABELS: Record<PendingAction["action"], string> = {
  addEmployee: "Add Employee",
  bulkAdd: "Bulk Add Employees",
  pauseStream: "Pause Stream",
  resumeStream: "Resume Stream",
  startStream: "Start Stream",
  editEmployee: "Edit Employee",
};

const DESTRUCTIVE_ACTIONS: PendingAction["action"][] = ["pauseStream", "editEmployee"];

interface ActionConfirmCardProps {
  result: PendingAction | { error: true; message: string };
  onConfirm: (action: PendingAction) => Promise<void>;
}

export function ActionConfirmCard({ result, onConfirm }: ActionConfirmCardProps) {
  if ("error" in result) {
    return (
      <AgentCard>
        <div className="flex items-center gap-2.5 px-4 py-3">
          <AlertTriangle className="size-4 text-red-400" strokeWidth={2} />
          <span className="text-[13px] text-red-400">{result.message}</span>
        </div>
      </AgentCard>
    );
  }

  if (result.action === "editEmployee") {
    return <EditEmployeeCard result={result} onConfirm={onConfirm} />;
  }

  return <GenericActionCard result={result} onConfirm={onConfirm} />;
}

function GenericActionCard({ result, onConfirm }: { result: PendingAction; onConfirm: (a: PendingAction) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const isDestructive = DESTRUCTIVE_ACTIONS.includes(result.action);

  return (
    <AgentCard accent={!isDestructive}>
      <CardHeader
        icon={ACTION_ICONS[result.action]}
        title={ACTION_LABELS[result.action]}
        subtitle="Requires wallet signature"
      />
      <div className="px-4 py-3">
        <p className="mb-3 text-[13px] text-[var(--sw-text-muted)]">{result.summary}</p>
        <ActionDataPreview action={result} />
        <div className="mt-3">
          {done ? (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--sw-mint)]/15 px-3 py-1.5 w-fit">
              <Check className="size-3.5 text-[var(--sw-mint)]" strokeWidth={2.5} />
              <span className="text-[12px] font-medium text-[var(--sw-mint)]">Done</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try { await onConfirm(result); setDone(true); } finally { setLoading(false); }
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors",
                isDestructive
                  ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                  : "bg-[var(--sw-mint)] text-black hover:bg-[#cef77f]"
              )}
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" strokeWidth={2.5} />}
              Sign & Execute
            </button>
          )}
        </div>
      </div>
    </AgentCard>
  );
}

type EditEmployeeData = {
  employeeId: string;
  alias: string;
  walletAddress: string;
  changes: {
    rate_amount?: number | null;
    rate_type?: string | null;
    token?: string | null;
    group_name?: string | null;
  };
};

function EditEmployeeCard({ result, onConfirm }: { result: Extract<PendingAction, { action: "editEmployee" }>; onConfirm: (a: PendingAction) => Promise<void> }) {
  const data = result.data as unknown as EditEmployeeData;
  const ch = data.changes ?? {};
  const { groupsQuery } = useSweemApi();
  const groups = groupsQuery.data ?? [];

  const [alias, setAlias] = useState(data.alias ?? "");
  const [rateAmount, setRateAmount] = useState(ch.rate_amount != null ? String(ch.rate_amount) : "");
  const [rateType, setRateType] = useState(ch.rate_type ?? "MONTHLY");
  const [token, setToken] = useState(ch.token ?? "USDC");
  const [groupId, setGroupId] = useState(ch.group_name ? (groups.find(g => g.name === ch.group_name)?.id ?? "") : "");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleConfirm = useCallback(async () => {
    setLoading(true);
    try {
      const selectedGroup = groups.find(g => g.id === groupId);
      const updated: PendingAction = {
        ...result,
        data: {
          employeeId: data.employeeId,
          alias: alias || data.alias,
          walletAddress: data.walletAddress,
          changes: {
            ...(alias && alias !== data.alias ? { alias } : {}),
            ...(rateAmount ? { rate_amount: Number(rateAmount), rate_type: rateType, token } : {}),
            ...(selectedGroup ? { group_name: selectedGroup.name } : {}),
          },
        },
        summary: `Edit ${alias || data.alias}`,
      };
      await onConfirm(updated);
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [result, data, alias, rateAmount, rateType, token, groupId, groups, onConfirm]);

  const inputCls = "w-full rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-2 text-[13px] text-[var(--sw-text)] outline-none focus:border-[var(--sw-mint)]/60 transition-colors placeholder:text-[var(--sw-text-dim)]";
  const labelCls = "text-[11px] font-medium text-[var(--sw-text-dim)] mb-1 block";

  return (
    <AgentCard>
      <CardHeader
        icon={<Edit3 className="size-4" strokeWidth={2} />}
        title={`Edit ${data.alias}`}
        subtitle="Modify fields then sign to confirm"
      />
      <div className="px-4 py-4 space-y-4">
        {/* Name */}
        <div>
          <label className={labelCls}>Display name</label>
          <input className={inputCls} value={alias} onChange={e => setAlias(e.target.value)} placeholder={data.alias} />
        </div>

        {/* Rate row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Amount</label>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="0.01"
              value={rateAmount}
              onChange={e => setRateAmount(e.target.value)}
              placeholder={ch.rate_amount != null ? String(ch.rate_amount) : "e.g. 5000"}
            />
          </div>
          <div>
            <label className={labelCls}>Token</label>
            <Select value={token} onValueChange={setToken}>
              <SelectTrigger className="h-9 rounded-lg border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[13px] text-[var(--sw-text)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USDC">USDC</SelectItem>
                <SelectItem value="SUI">SUI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={labelCls}>Period</label>
            <Select value={rateType} onValueChange={setRateType}>
              <SelectTrigger className="h-9 rounded-lg border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[13px] text-[var(--sw-text)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="HOURLY">Hourly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Group — from org's actual groups */}
        <div>
          <label className={labelCls}>Group / department</label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="h-9 w-full rounded-lg border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[13px] text-[var(--sw-text)]">
              <SelectValue placeholder="Select group…" />
            </SelectTrigger>
            <SelectContent>
              {groups.map(g => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
              {groups.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-[var(--sw-text-dim)]">No groups found</div>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="pt-1">
          {done ? (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--sw-mint)]/15 px-3 py-1.5 w-fit">
              <Check className="size-3.5 text-[var(--sw-mint)]" strokeWidth={2.5} />
              <span className="text-[12px] font-medium text-[var(--sw-mint)]">Done</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={handleConfirm}
              className="flex items-center gap-2 rounded-lg bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black hover:bg-[#cef77f] transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" strokeWidth={2.5} />}
              Sign & Execute
            </button>
          )}
        </div>
      </div>
    </AgentCard>
  );
}

function ActionDataPreview({ action }: { action: PendingAction }) {
  if (action.action === "bulkAdd") {
    const rows = action.data as unknown[];
    return (
      <div className="rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-2">
        <p className="text-[12px] text-[var(--sw-text-dim)]">
          {rows.length} employees queued for import
        </p>
      </div>
    );
  }

  const fields = Object.entries(action.data).filter(
    ([k, v]) => v != null && k !== "employeeId"
  );
  return (
    <div className="rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-2">
      <div className="grid gap-1">
        {fields.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-[var(--sw-text-dim)]">
              {k.replace(/_/g, " ")}
            </span>
            <span className="text-[11px] font-medium text-[var(--sw-text-muted)]">
              {String(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Employee detail card ──────────────────────────────────────────────────────

export function EmployeeDetailCard({
  data,
}: {
  data: {
    employees: EmployeeRow[];
    found: boolean;
  };
}) {
  if (!data.found || data.employees.length === 0) {
    return (
      <AgentCard>
        <div className="flex items-center gap-2.5 px-4 py-3">
          <AlertTriangle className="size-4 text-yellow-400" strokeWidth={2} />
          <span className="text-[13px] text-[var(--sw-text-muted)]">No matching employee found.</span>
        </div>
      </AgentCard>
    );
  }
  return <EmployeeListCard data={{ employees: data.employees, count: data.employees.length }} />;
}
