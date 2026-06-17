"use client";

import { useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSweemApi, type Employee, type Group } from "@/lib/api";
import { useStreamedAddresses } from "@/lib/useStreamStatus";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_GROUP = "__none__";

function shortAddr(a: string) {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function monthlyRate(e: Employee): number {
  // Backend returns numeric columns as strings — coerce to Number.
  const r = e.rates.find((x) => x.token === "USDC");
  return r ? Number(r.rateAmount) || 0 : 0;
}

const Employees = () => {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const qc = useQueryClient();

  const [alias, setAlias] = useState("");
  const [addr, setAddr] = useState("");
  const [rate, setRate] = useState("");
  const [groupId, setGroupId] = useState<string>(NO_GROUP);
  const [busy, setBusy] = useState(false);

  const org = api.orgQuery.data;
  const groups = api.groupsQuery.data ?? [];
  const employees = api.employeesQuery.data ?? [];

  // On-chain streaming status per employee (shared cache w/ Org via query keys).
  const poolsQuery = useQuery({
    queryKey: ["pools", wallet],
    queryFn: () => api.listPools(wallet!),
    enabled: !!wallet && !!org,
    refetchInterval: 8000,
  });
  const onChainPoolId = poolsQuery.data?.find((p) => p.token === "USDC")?.onChainPoolId;
  const { streamed } = useStreamedAddresses(onChainPoolId);

  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => m.set(g.id, g.name));
    return m;
  }, [groups]);

  // group employees by their groupId (null bucket last)
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

  async function handleAdd() {
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

  if (!wallet || !org) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employees</CardTitle>
        <CardDescription>
          Add employees and set each one&apos;s monthly USDC rate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* add form */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="emp-alias">Alias</Label>
            <Input
              id="emp-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Jane"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="emp-addr">Wallet address</Label>
            <Input
              id="emp-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emp-rate">Monthly USDC</Label>
            <Input
              id="emp-rate"
              type="number"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="3000"
            />
          </div>
          <div className="space-y-2">
            <Label>Group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="No group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>No group</SelectItem>
                {groups.map((g: Group) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleAdd} disabled={busy}>
          Add employee
        </Button>

        {/* grouped list */}
        {employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No employees yet.</p>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([key, rows]) => (
              <div key={key} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {key === NO_GROUP ? "Ungrouped" : groupName.get(key) ?? key}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alias</TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead className="text-right">Monthly USDC</TableHead>
                      <TableHead>Group</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => (
                      <SingleEmployee
                        key={e.id}
                        employee={e}
                        groupLabel={
                          e.groupId ? groupName.get(e.groupId) ?? null : null
                        }
                        hasPool={!!onChainPoolId}
                        streaming={streamed.has(e.walletAddress)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SingleEmployee = ({
  employee,
  groupLabel,
  hasPool,
  streaming,
}: {
  employee: Employee;
  groupLabel: string | null;
  hasPool: boolean;
  streaming: boolean;
}) => {
  return (
    <TableRow>
      <TableCell className="font-medium">{employee.alias}</TableCell>
      <TableCell className="font-mono text-xs">
        {shortAddr(employee.walletAddress)}
      </TableCell>
      <TableCell className="text-right">
        {monthlyRate(employee).toFixed(2)}
      </TableCell>
      <TableCell>
        {groupLabel ? (
          <Badge variant="outline">{groupLabel}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {monthlyRate(employee) <= 0 ? (
          <span className="text-muted-foreground">No rate</span>
        ) : !hasPool ? (
          <span className="text-muted-foreground">—</span>
        ) : streaming ? (
          <Badge>Streaming</Badge>
        ) : (
          <Badge variant="secondary">Pending</Badge>
        )}
      </TableCell>
    </TableRow>
  );
};

export default Employees;
