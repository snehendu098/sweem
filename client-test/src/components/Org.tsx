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
  topupTx,
  orgWithdrawNaviTx,
  orgWithdrawScallopTx,
  findCreatedPoolId,
  investNaviTx,
  investScallopTx,
  poolHasNaviCap,
  readPoolSummary,
  readPoolInvestments,
  readClaimable,
  type EmployeeStream,
} from "@/lib/tx";
import { useStreamedAddresses } from "@/lib/useStreamStatus";

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

// Gross deposit needed so that, after the 0.25% deposit fee, at least `netRaw`
// lands in the pool. ceil(net / 0.9975) + 1 raw cushion. 0 maps to 0.
function grossForNet(netRaw: bigint): bigint {
  if (netRaw <= 0n) return 0n;
  return (netRaw * 10_000n + 9_974n) / 9_975n + 1n;
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

  // wallet USDC (number for display, raw bigint for coverage math)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [walletRaw, setWalletRaw] = useState<bigint>(0n);

  // top-up + rebalance dialog state
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmt, setTopUpAmt] = useState("");
  const [rebalOpen, setRebalOpen] = useState(false);
  const [naviPull, setNaviPull] = useState("");
  const [scallopPull, setScallopPull] = useState("");

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

  // ----- employees added to the backend but not yet streaming on-chain -----
  const { streamed, refetch: refetchStreamed } = useStreamedAddresses(
    funded ? onChainPoolId : undefined,
  );
  const pending = useMemo(
    () => employees.filter((e) => monthlyRate(e) > 0 && !streamed.has(e.walletAddress)),
    [employees, streamed],
  );
  // Adding streams raises the coverage floor; new hires draw from existing idle,
  // so idle must cover (current weekly commit + the new hires' weekly commit).
  const addedWeeklyRaw = useMemo(
    () =>
      pending.reduce(
        (acc, e) => acc + weeklyCommitRaw(toRaw(monthlyRate(e)), BigInt(MONTH_MS)),
        0n,
      ),
    [pending],
  );
  const newFloorRaw = (s?.summary.weeklyCommittedRaw ?? 0n) + addedWeeklyRaw;
  const shortfallRaw = s && newFloorRaw > s.summary.idleRaw ? newFloorRaw - s.summary.idleRaw : 0n;
  const coverShortUsdc = fromRaw(shortfallRaw);
  // Gross-up the shortfall for the 0.25% deposit fee (+1 raw cushion) so the net
  // added clears the coverage floor exactly. 0 when idle already covers it.
  const streamFundRaw = grossForNet(shortfallRaw);
  // "Stream to N new" funds the shortfall from the wallet; works if idle covers
  // it (streamFundRaw=0) OR the wallet can cover the top-up.
  const canStreamNew = walletRaw >= streamFundRaw;

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
  useEffect(() => {
    if (!wallet) return;
    client
      .getBalance({ owner: wallet, coinType: USDC })
      .then((b) => {
        setUsdcBalance(fromRaw(b.totalBalance));
        setWalletRaw(BigInt(b.totalBalance));
      })
      .catch(() => setUsdcBalance(null));
  }, [wallet, client, poolState.dataUpdatedAt]);

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

  // ----- Stream to employees added after the first fund -----
  // Deposits with ONLY the pending addresses (existing streams untouched). Draws
  // from existing idle when it covers the higher floor; otherwise tops up just
  // the shortfall (grossed up for the fee) from the org wallet in the same tx.
  async function handleStreamNewEmployees() {
    if (!wallet || !onChainPoolId || pending.length === 0) return;
    if (!canStreamNew) {
      toast.error(
        `Idle short ~${coverShortUsdc.toFixed(2)} USDC and wallet can't cover — top up or rebalance first`,
      );
      return;
    }
    setBusy(true);
    const t = toast.loading("Starting streams for new employees…");
    try {
      const roster: EmployeeStream[] = pending.map((e) => ({
        address: e.walletAddress,
        rateRaw: toRaw(monthlyRate(e)),
        periodMs: BigInt(MONTH_MS),
      }));
      const dep = await signAndExecute({
        transaction: depositTx(onChainPoolId, streamFundRaw, roster),
      });
      await client.waitForTransaction({
        digest: dep.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await qc.invalidateQueries({ queryKey: ["pools", wallet] });
      await Promise.all([poolState.refetch(), refetchStreamed()]);
      toast.success(`Streaming to ${roster.length} new employee(s)`, { id: t });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ----- Top up: add liquid idle to the pool from the wallet (no stream change) -----
  async function handleTopUp() {
    if (!wallet || !onChainPoolId) return;
    const amount = Number(topUpAmt);
    if (!(amount > 0)) {
      toast.error("Enter a positive USDC amount");
      return;
    }
    setBusy(true);
    const t = toast.loading("Topping up pool…");
    try {
      const r = await signAndExecute({
        transaction: topupTx(onChainPoolId, toRaw(amount)),
      });
      await client.waitForTransaction({
        digest: r.digest,
        options: { showEffects: true, showObjectChanges: true },
      });
      await poolState.refetch();
      toast.success(`Topped up ${amount.toFixed(2)} USDC`, { id: t });
      setTopUpOpen(false);
      setTopUpAmt("");
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // ----- Rebalance: pull invested principal back from Navi/Scallop to idle -----
  async function handleRebalance() {
    if (!wallet || !onChainPoolId) return;
    const navi = Number(naviPull) || 0;
    const scallop = Number(scallopPull) || 0;
    if (navi <= 0 && scallop <= 0) {
      toast.error("Enter an amount to pull from Navi or Scallop");
      return;
    }
    if (navi > naviUsdc) {
      toast.error("Navi amount exceeds invested principal");
      return;
    }
    if (scallop > scallopUsdc) {
      toast.error("Scallop amount exceeds invested principal");
      return;
    }
    setBusy(true);
    const t = toast.loading("Rebalancing to idle…");
    try {
      if (navi > 0) {
        toast.loading("Withdrawing from Navi…", { id: t });
        const r = await signAndExecute({
          transaction: orgWithdrawNaviTx(onChainPoolId, toRaw(navi)),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
      if (scallop > 0) {
        toast.loading("Withdrawing from Scallop…", { id: t });
        const r = await signAndExecute({
          transaction: orgWithdrawScallopTx(onChainPoolId, toRaw(scallop)),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true, showObjectChanges: true },
        });
      }
      await poolState.refetch();
      toast.success("Funds moved back to idle", { id: t });
      setRebalOpen(false);
      setNaviPull("");
      setScallopPull("");
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
              <div className="flex flex-wrap items-center gap-2">
                {pending.length > 0 && (
                  <Button
                    onClick={handleStreamNewEmployees}
                    disabled={busy || !canStreamNew}
                  >
                    Stream to {pending.length} new
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setTopUpAmt(shortfallRaw > 0n ? coverShortUsdc.toFixed(2) : "");
                    setTopUpOpen(true);
                  }}
                  disabled={busy}
                >
                  Top up
                </Button>
                {naviUsdc + scallopUsdc > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setNaviPull("");
                      setScallopPull("");
                      setRebalOpen(true);
                    }}
                    disabled={busy}
                  >
                    Rebalance
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={openInvestMore}
                  disabled={busy || idleUsdc <= floorUsdc}
                >
                  Invest idle funds
                </Button>
              </div>
            ) : (
              <Button onClick={handleFundAndStart} disabled={busy || employees.length === 0}>
                Fund &amp; start
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {funded && pending.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span className="font-medium">{pending.length}</span> employee(s) not streaming
              yet.{" "}
              {shortfallRaw === 0n
                ? `Click "Stream to ${pending.length} new" to start their streams.`
                : canStreamNew
                  ? `Idle is ~${coverShortUsdc.toFixed(2)} USDC short — "Stream to ${pending.length} new" will add it from your wallet, or use Top up / Rebalance to fund from the pool.`
                  : `Idle is ~${coverShortUsdc.toFixed(2)} USDC short and your wallet can't cover it. Use Top up or Rebalance invested funds first.`}
            </div>
          )}
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

      {/* Top-up dialog */}
      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top up pool</DialogTitle>
            <DialogDescription>
              Add liquid USDC to the pool&apos;s idle balance from your wallet
              (wallet: {usdcBalance == null ? "—" : usdcBalance.toFixed(2)} USDC).
              {shortfallRaw > 0n &&
                ` New hires need ~${coverShortUsdc.toFixed(2)} USDC more idle.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="topup-amt">Amount (USDC)</Label>
            <Input
              id="topup-amt"
              type="number"
              inputMode="decimal"
              value={topUpAmt}
              onChange={(e) => setTopUpAmt(e.target.value)}
              placeholder="1.00"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopUpOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleTopUp} disabled={busy || !(Number(topUpAmt) > 0)}>
              Top up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebalance dialog */}
      <Dialog open={rebalOpen} onOpenChange={setRebalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rebalance to idle</DialogTitle>
            <DialogDescription>
              Pull invested principal back to the pool&apos;s liquid idle balance.
              Invested: Navi {naviUsdc.toFixed(2)} · Scallop{" "}
              {scallopUsdc.toFixed(2)} USDC.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {naviUsdc > 0 && (
              <div className="space-y-2">
                <Label htmlFor="navi-pull">
                  From Navi (max {naviUsdc.toFixed(2)})
                </Label>
                <Input
                  id="navi-pull"
                  type="number"
                  inputMode="decimal"
                  value={naviPull}
                  onChange={(e) => setNaviPull(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
            {scallopUsdc > 0 && (
              <div className="space-y-2">
                <Label htmlFor="scallop-pull">
                  From Scallop (max {scallopUsdc.toFixed(2)})
                </Label>
                <Input
                  id="scallop-pull"
                  type="number"
                  inputMode="decimal"
                  value={scallopPull}
                  onChange={(e) => setScallopPull(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRebalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRebalance}
              disabled={
                busy ||
                !((Number(naviPull) || 0) > 0 || (Number(scallopPull) || 0) > 0)
              }
            >
              Rebalance
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
