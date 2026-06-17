"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSweemApi, type Employee, type Group } from "@/lib/api";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { ActionButton, ConnectGate } from "./ui";
import { monthlyRate, shortAddr } from "./helpers";

const NO_GROUP = "__none__";

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
      {/* add employee */}
      <div className="sweem-card mt-5 mb-5">
        <p className="sweem-card-title mb-4">Add employee</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
          <div>
            <label className="sweem-label">Alias</label>
            <input
              className="sweem-input"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="sweem-label">Wallet address</label>
            <input
              className="sweem-input"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <div>
            <label className="sweem-label">Monthly USDC</label>
            <input
              className="sweem-input"
              type="number"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="3000"
            />
          </div>
          <div>
            <label className="sweem-label">Group</label>
            <select
              className="sweem-input"
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
          </div>
        </div>
        <div className="mt-4">
          <ActionButton variant="primary" onClick={handleAddEmployee} disabled={busy}>
            Add employee
          </ActionButton>
        </div>
      </div>

      {/* groups */}
      <div className="sweem-card mb-5">
        <p className="sweem-card-title mb-4">Groups</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="sweem-label">New group</label>
            <input
              className="sweem-input"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Engineering"
            />
          </div>
          <ActionButton onClick={handleCreateGroup} disabled={busy || !groupName.trim()}>
            Create group
          </ActionButton>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {groups.length === 0 ? (
            <p className="sweem-hint">No groups yet.</p>
          ) : (
            groups.map((g) => (
              <span key={g.id} className="sweem-badge sweem-badge-idle">
                {g.name}
              </span>
            ))
          )}
        </div>
      </div>

      {/* roster */}
      <div className="dashboard-data-table-wrap">
        {employees.length === 0 ? (
          <div className="sweem-gate">No employees yet.</div>
        ) : (
          <table className="sweem-table">
            <thead>
              <tr>
                <th>Alias</th>
                <th>Wallet</th>
                <th>Monthly USDC</th>
                <th>Group</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).flatMap(([key, rows]) =>
                rows.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.alias}</td>
                    <td className="sweem-mono text-xs">{shortAddr(e.walletAddress)}</td>
                    <td>{monthlyRate(e).toFixed(2)}</td>
                    <td>
                      <span className="sweem-hint">
                        {key === NO_GROUP ? "Ungrouped" : groupLabel.get(key) ?? key}
                      </span>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        )}
      </div>
    </DashboardPageShell>
  );
}
