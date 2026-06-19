"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Coins, Layers, UserPlus, Users, Wallet } from "lucide-react";

import { useSweemApi, type Employee, type Group } from "@/lib/api";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import {
  CardLabel,
  IconChip,
  MoneyValue,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { ConnectGate } from "./ui";
import { monthlyRate, shortAddr } from "./helpers";

const NO_GROUP = "__none__";

const inputCls =
  "w-full rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]";

const AVATAR_TONES = [
  { bg: "rgba(196,245,107,0.14)", fg: "var(--sw-mint)" },
  { bg: "rgba(188,174,247,0.16)", fg: "var(--sw-lavender)" },
] as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[12px] font-medium text-[var(--sw-text-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <SweemCard className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {children}
      </div>
    </SweemCard>
  );
}

function MintButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-5 py-2.5 text-[13px] font-semibold text-[var(--sw-text)] transition-colors hover:border-[var(--sw-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function EmployeesScreen() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const qc = useQueryClient();

  const [alias, setAlias] = useState("");
  const [addr, setAddr] = useState("");
  const [rate, setRate] = useState("");
  const [groupId, setGroupId] = useState<string>(NO_GROUP);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);

  const org = api.orgQuery.data;
  const groups = api.groupsQuery.data ?? [];
  const employees = api.employeesQuery.data ?? [];

  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => m.set(g.id, g.name));
    return m;
  }, [groups]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, Employee[]>();
    for (const e of employees) {
      const key = e.groupId ?? NO_GROUP;
      const arr = buckets.get(key) ?? [];
      arr.push(e);
      buckets.set(key, arr);
    }
    return buckets;
  }, [employees]);

  const totalMonthly = useMemo(
    () => employees.reduce((s, e) => s + monthlyRate(e), 0),
    [employees],
  );
  const avgMonthly = employees.length ? totalMonthly / employees.length : 0;

  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    employees.forEach((e) => {
      const k = e.groupId ?? NO_GROUP;
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [employees]);

  async function handleAddEmployee() {
    if (!wallet) return;
    const amount = Number(rate);
    if (!alias.trim() || !addr.trim() || !(amount > 0)) {
      toast.error("Alias, wallet address and a positive USDC rate are required");
      return;
    }
    setBusy(true);
    try {
      await api.addEmployee(wallet, {
        alias: alias.trim(),
        wallet_address: addr.trim(),
        group_id: groupId === NO_GROUP ? undefined : groupId,
        rates: [{ token: "USDC", rate_amount: amount, rate_type: "MONTHLY" }],
      });
      toast.success(`Added ${alias.trim()}`);
      setAlias("");
      setAddr("");
      setRate("");
      setGroupId(NO_GROUP);
      await qc.invalidateQueries({ queryKey: ["employees", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateGroup() {
    if (!wallet || !groupName.trim()) return;
    setBusy(true);
    try {
      await api.createGroup(wallet, groupName.trim());
      toast.success(`Group "${groupName.trim()}" created`);
      setGroupName("");
      await qc.invalidateQueries({ queryKey: ["groups", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <DashboardPageShell title="Employees">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to manage employees." />
        </div>
      </DashboardPageShell>
    );
  }
  if (!org) {
    return (
      <DashboardPageShell title="Employees">
        <div className="sweem-card mt-5">
          <ConnectGate message="Create your organization on the Overview page first." />
        </div>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title="Employees"
      subtitle="Add team members and set each one's monthly USDC rate."
    >
      {/* stats */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Users className="size-[18px]" strokeWidth={2} />} label="Employees">
          {employees.length}
        </StatCard>
        <StatCard icon={<Wallet className="size-[18px]" strokeWidth={2} />} label="Monthly payroll">
          <MoneyValue value={totalMonthly} />
        </StatCard>
        <StatCard icon={<Coins className="size-[18px]" strokeWidth={2} />} label="Avg / employee">
          <MoneyValue value={avgMonthly} />
        </StatCard>
        <StatCard icon={<Layers className="size-[18px]" strokeWidth={2} />} label="Groups">
          {groups.length}
        </StatCard>
      </div>

      {/* add employee + groups */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SweemCard className="flex flex-col lg:col-span-2">
          <div className="flex items-center gap-3">
            <IconChip>
              <UserPlus className="size-[18px]" strokeWidth={2} />
            </IconChip>
            <CardLabel className="text-[15px] text-[var(--sw-text)]">Add employee</CardLabel>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Alias">
              <input
                className={inputCls}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Jane"
              />
            </Field>
            <Field label="Monthly USDC">
              <input
                className={inputCls}
                type="number"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="3000"
              />
            </Field>
            <Field label="Wallet address" className="sm:col-span-2">
              <input
                className={`${inputCls} font-mono`}
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="0x…"
              />
            </Field>
            <Field label="Group" className="sm:col-span-2">
              <select
                className={inputCls}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value={NO_GROUP}>No group</option>
                {groups.map((g: Group) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-5">
            <MintButton onClick={handleAddEmployee} disabled={busy}>
              <UserPlus className="size-[15px]" strokeWidth={2.2} /> Add employee
            </MintButton>
          </div>
        </SweemCard>

        <SweemCard className="flex flex-col">
          <div className="flex items-center gap-3">
            <IconChip>
              <Layers className="size-[18px]" strokeWidth={2} />
            </IconChip>
            <CardLabel className="text-[15px] text-[var(--sw-text)]">Groups</CardLabel>
          </div>
          <Field label="New group" className="mt-5">
            <input
              className={inputCls}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Engineering"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateGroup();
              }}
            />
          </Field>
          <div className="mt-3">
            <GhostButton onClick={handleCreateGroup} disabled={busy || !groupName.trim()}>
              Create group
            </GhostButton>
          </div>
          <div className="mt-5 flex flex-1 flex-wrap content-start gap-2">
            {groups.length === 0 ? (
              <p className="text-[12.5px] text-[var(--sw-text-dim)]">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[12.5px] text-[var(--sw-text-muted)]"
                >
                  <span className="size-2 rounded-full bg-[var(--sw-lavender)]" />
                  {g.name}
                  <span className="font-semibold tabular-nums text-[var(--sw-text)]">
                    {memberCount.get(g.id) ?? 0}
                  </span>
                </span>
              ))
            )}
          </div>
        </SweemCard>
      </div>

      {/* roster, grouped */}
      <div className="mt-4 flex flex-col gap-4">
        {employees.length === 0 ? (
          <SweemCard hover={false}>
            <div className="flex h-[120px] items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
              No employees yet — add your first team member above.
            </div>
          </SweemCard>
        ) : (
          Array.from(grouped.entries()).map(([key, rows]) => {
            const groupTotal = rows.reduce((s, e) => s + monthlyRate(e), 0);
            const name = key === NO_GROUP ? "Ungrouped" : groupLabel.get(key) ?? key;
            return (
              <SweemCard key={key} className="flex flex-col" hover={false}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: key === NO_GROUP ? "var(--sw-text-dim)" : "var(--sw-lavender)" }}
                    />
                    <CardLabel className="text-[15px] text-[var(--sw-text)]">{name}</CardLabel>
                    <span className="rounded-full bg-[var(--sw-card-inset)] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[var(--sw-text-muted)]">
                      {rows.length}
                    </span>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text-muted)]">
                    ${groupTotal.toFixed(2)}
                    <span className="ml-1 text-[11.5px] font-medium text-[var(--sw-text-dim)]">/ mo</span>
                  </span>
                </div>

                <ul className="mt-2 flex flex-col">
                  {rows.map((e, i) => {
                    const tone =
                      AVATAR_TONES[
                        (e.alias.charCodeAt(0) + e.alias.length) % AVATAR_TONES.length
                      ];
                    return (
                      <motion.li
                        key={e.id}
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.04 * i, type: "spring", stiffness: 240, damping: 26 }}
                        className="flex items-center gap-3 border-t border-[var(--sw-border)] py-3 first:border-t-0"
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold"
                          style={{ background: tone.bg, color: tone.fg }}
                        >
                          {initials(e.alias)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-[var(--sw-text)]">
                            {e.alias}
                          </p>
                          <p className="truncate font-mono text-[11.5px] text-[var(--sw-text-dim)]">
                            {shortAddr(e.walletAddress)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[13.5px] font-semibold tabular-nums text-[var(--sw-text)]">
                            ${monthlyRate(e).toFixed(2)}
                          </p>
                          <p className="text-[11px] text-[var(--sw-text-dim)]">/ month</p>
                        </div>
                      </motion.li>
                    );
                  })}
                </ul>
              </SweemCard>
            );
          })
        )}
      </div>
    </DashboardPageShell>
  );
}
