"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSweemApi, type Employee } from "@/lib/api";
import {
  USDC,
  MONTH_MS,
  WEEK_MS,
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
  poolHasNaviCap,
  readPoolSummary,
  readPoolInvestments,
  readClaimable,
  type EmployeeStream,
} from "@/lib/tx";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProtocolRow } from "@/components/ProtocolRow";

// Monthly USDC rate for an employee from their stored rates.
// NOTE: the backend returns numeric columns as strings, so coerce with Number().
function monthlyRate(e: Employee): number {
  const r = e.rates.find((x) => x.token === "USDC");
  return r ? Number(r.rateAmount) || 0 : 0;
}

interface YieldRow {
  protocol: "NAVI" | "SCALLOP";
  apy: number;
}

// Format nano-USDC (1e-9 USDC, bigint) as "int.fffffffff" (9 decimals).
const NANO = 1_000_000_000n;
function formatNano9(nano: bigint): string {
  return `${nano / NANO}.${(nano % NANO).toString().padStart(9, "0")}`;
}

const Org = () => {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const client = useSuiClient();
  const qc = useQueryClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [orgName, setOrgName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false); // set true right after first fund

  // invest dialog state
  const [investOpen, setInvestOpen] = useState(false);
  const [poolId, setPoolId] = useState<string>("");
  const [depositedUsdc, setDepositedUsdc] = useState(0);
  const [coverageFloor, setCoverageFloor] = useState(0); // USDC
  const [naviYes, setNaviYes] = useState(true);
  const [scallopYes, setScallopYes] = useState(true);
  const [naviAmt, setNaviAmt] = useState("");
  const [scallopAmt, setScallopAmt] = useState("");

  const org = api.orgQuery.data;
  const groups = api.groupsQuery.data ?? [];
  const employees = api.employeesQuery.data ?? [];
  const quotes: YieldRow[] = api.yieldsQuery.data?.quotes ?? [];

  const naviApy = quotes.find((q) => q.protocol === "NAVI")?.apy;
  const scallopApy = quotes.find((q) => q.protocol === "SCALLOP")?.apy;

  const totalMonthly = useMemo(
    () => employees.reduce((s, e) => s + monthlyRate(e), 0),
    [employees],
  );

  // ----- the org's on-chain USDC pool -----
  const poolsQuery = useQuery({
    queryKey: ["pools", wallet],
    queryFn: () => api.listPools(wallet!),
    enabled: !!wallet && !!org,
    refetchInterval: 8000,
  });
  const onChainPoolId = poolsQuery.data?.find((p) => p.token === "USDC")?.onChainPoolId;

  // ----- live pool state: balance, invested positions, streamed-to-date -----
  const empAddrs = employees.map((e) => e.walletAddress);
  const poolState = useQuery({
    queryKey: ["poolState", onChainPoolId, empAddrs.join(",")],
    enabled: !!onChainPoolId,
    refetchInterval: 5000,
    queryFn: async () => {
      const id = onChainPoolId!;
      const [summary, inv, claimables] = await Promise.all([
        readPoolSummary(client, id),
        readPoolInvestments(client, id),
        Promise.all(empAddrs.map((a) => readClaimable(client, id, a).catch(() => 0n))),
      ]);
      const accruedRaw = claimables.reduce((s, c) => s + c, 0n);
      return { summary, inv, accruedRaw };
    },
  });

  const s = poolState.data;
  const funded = started || (s ? s.summary.totalDepositedRaw > 0n : false);
  const idleUsdc = s ? fromRaw(s.summary.idleRaw) : 0;
  const naviUsdc = s ? fromRaw(s.inv.naviRaw) : 0;
  const scallopUsdc = s ? fromRaw(s.inv.scallopRaw) : 0;
  const totalInPool = idleUsdc + naviUsdc + scallopUsdc;
  const streamedBaseRaw = s ? s.summary.totalClaimedRaw + s.accruedRaw : 0n;
  const weeklyRaw = s ? s.summary.weeklyCommittedRaw : 0n;
  const floorUsdc = s ? fromRaw(s.summary.weeklyCommittedRaw) : 0;

  // Live-ticking "streamed to date": base (claimed + accrued at the last poll) +
  // the on-chain weekly rate interpolated each animation frame — exact bigint
  // (nano-USDC, 9 dp) so the low-order digits churn like the employee balance.
  const anchorAt = poolState.dataUpdatedAt;
  const [streamedDisplay, setStreamedDisplay] = useState("0.000000000");
  useEffect(() => {
    if (!funded) {
      setStreamedDisplay(formatNano9(streamedBaseRaw * 1000n));
      return;
    }
    let raf = 0;
    const tick = () => {
      const elapsed = BigInt(Math.max(0, Date.now() - anchorAt));
      const accruedNano =
        weeklyRaw > 0n ? (weeklyRaw * 1000n * elapsed) / BigInt(WEEK_MS) : 0n;
      setStreamedDisplay(formatNano9(streamedBaseRaw * 1000n + accruedNano));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [funded, streamedBaseRaw, weeklyRaw, anchorAt]);

  // ----- USDC balance for the card -----
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!wallet) return;
    client
      .getBalance({ owner: wallet, coinType: USDC })
      .then((b) => setUsdcBalance(fromRaw(b.totalBalance)))
      .catch(() => setUsdcBalance(null));
  }, [wallet, client]);

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

  // Open the invest dialog using the CURRENT idle balance (for "invest more").
  function openInvestMore() {
    if (!onChainPoolId) return;
    setPoolId(onChainPoolId);
    setDepositedUsdc(idleUsdc);
    setCoverageFloor(floorUsdc);
    setNaviAmt("");
    setScallopAmt("");
    setInvestOpen(true);
  }

  // ----- Fund & start: ensure pool, deposit (fund + stream), open invest dialog -----
  async function handleFundAndStart() {
    if (!wallet || funded) return;
    if (employees.length === 0) {
      toast.error("Add employees before funding");
      return;
    }
    setBusy(true);
    const t = toast.loading("Preparing pool…");
    try {
      // 1. ensure on-chain pool
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

      // 2. fund + start streaming via deposit
      const roster: EmployeeStream[] = employees
        .filter((e) => monthlyRate(e) > 0)
        .map((e) => ({
          address: e.walletAddress,
          rateRaw: toRaw(monthlyRate(e)),
          periodMs: BigInt(MONTH_MS),
        }));
      if (roster.length === 0) throw new Error("No employees with a USDC rate");

      const totalRaw = toRaw(totalMonthly);
      toast.loading("Funding pool & starting streams…", { id: t });
      const dep = await signAndExecute({
        transaction: depositTx(createdPoolId, totalRaw, roster),
      });
      await client.waitForTransaction({
        digest: dep.digest,
        options: { showEffects: true, showObjectChanges: true },
      });

      // coverage floor = Σ weeklyCommitRaw across streams
      const floorRaw = roster.reduce(
        (acc, r) => acc + weeklyCommitRaw(r.rateRaw, r.periodMs),
        0n,
      );

      // streams are live now — lock the fund button and refresh pool state
      setStarted(true);
      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await poolState.refetch();

      // 3. open invest dialog
      setPoolId(createdPoolId);
      setDepositedUsdc(totalMonthly);
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

  // investable ceiling = (idle/deposited) - coverage floor
  const investable = Math.max(0, depositedUsdc - coverageFloor);
  const naviNum = Number(naviAmt) || 0;
  const scallopNum = Number(scallopAmt) || 0;

  const validationError = (() => {
    if (naviYes) {
      if (naviNum > investable) return "Navi amount exceeds investable balance";
      if (naviNum < NAVI_MIN_INVEST_USDC)
        return `Navi requires at least ${NAVI_MIN_INVEST_USDC} USDC`;
    }
    if (scallopYes && scallopNum > investable)
      return "Scallop amount exceeds investable balance";
    if (naviYes && scallopYes && naviNum + scallopNum > investable)
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

  // ----- render -----
  if (!wallet) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>Connect a wallet to get started.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (api.orgQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>Loading organization…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!org) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Create organization</CardTitle>
          <CardDescription>
            Onboard your org to start streaming payroll.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Inc."
            />
          </div>
          <Button onClick={handleCreateOrg} disabled={busy || !orgName.trim()}>
            Create organization
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Org card */}
      <Card>
        <CardHeader>
          <CardTitle>{org.name}</CardTitle>
          <CardDescription>
            {funded
              ? `Streaming live · ${employees.length} employee(s)`
              : `${employees.length} employee(s) · not funded yet`}
          </CardDescription>
          <CardAction>
            {funded ? (
              <Button
                variant="outline"
                onClick={openInvestMore}
                disabled={busy || idleUsdc <= floorUsdc}
              >
                Invest idle funds
              </Button>
            ) : (
              <Button onClick={handleFundAndStart} disabled={busy || employees.length === 0}>
                Fund &amp; start
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Monthly payroll"
              value={`${totalMonthly.toFixed(2)} USDC`}
            />
            <Stat
              label="Pool status"
              value={
                <Badge variant={funded ? "default" : "secondary"}>
                  {funded ? "Streaming" : "Not funded"}
                </Badge>
              }
            />
            <Stat
              label="Streamed to date"
              value={
                <span className="font-mono tabular-nums text-base">
                  {streamedDisplay}
                  <span className="ml-1 text-xs text-muted-foreground">USDC</span>
                </span>
              }
            />
            <Stat
              label="Total in pool"
              value={`${totalInPool.toFixed(2)} USDC`}
            />
            <Stat
              label="Idle (liquid)"
              value={`${idleUsdc.toFixed(2)} USDC`}
            />
            <Stat
              label="Wallet USDC"
              value={usdcBalance == null ? "—" : `${usdcBalance.toFixed(2)} USDC`}
            />
          </div>

          {funded && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Stat
                  label="Invested · Navi"
                  value={`${naviUsdc.toFixed(2)} USDC`}
                />
                <Stat
                  label="Invested · Scallop"
                  value={`${scallopUsdc.toFixed(2)} USDC`}
                />
                <Stat
                  label="Coverage floor"
                  value={`${floorUsdc.toFixed(2)} USDC/wk`}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Groups panel */}
      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
          <CardDescription>Organize employees into groups.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="group-name">New group</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Engineering"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleCreateGroup}
              disabled={busy || !groupName.trim()}
            >
              Create group
            </Button>
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <Badge key={g.id} variant="outline">
                  {g.name}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invest dialog */}
      <Dialog open={investOpen} onOpenChange={setInvestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invest idle pool funds</DialogTitle>
            <DialogDescription>
              Earn yield on the portion of the pool not reserved for the next
              week of streams. Investable now: {investable.toFixed(2)} USDC
              (coverage floor {coverageFloor.toFixed(2)} USDC).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setInvestOpen(false)}>
              Skip
            </Button>
            <Button
              onClick={handleConfirmInvest}
              disabled={busy || !!validationError}
            >
              Invest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}

export default Org;
