"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSweemApi } from "@/lib/api";
import {
  fromRaw,
  toRaw,
  minClaimRaw,
  NAVI_MIN_INVEST_USDC,
} from "@/lib/sweem";
import {
  findMyStreamPools,
  readStream,
  readPoolOrg,
  readClaimable,
  readPoolSummary,
  readPoolInvestments,
  findMyVault,
  findCreatedVaultId,
  createVaultTx,
  initBucketTx,
  claimToWalletTx,
  claimToVaultTx,
  vaultInvestNaviTx,
  vaultInvestScallopTx,
  vaultHasNaviCap,
  readVaultInvestments,
  type StreamState,
  type CoverOpts,
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

const short = (a: string) =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

// Format nano-USDC (1e-9 USDC, bigint) as "int.fffffffff" with 9 decimals.
// Exact integer math — no float drift, and the low-order digits move fast enough
// to look like a live ms counter.
const NANO = 1_000_000_000n;
function formatNano(nano: bigint): string {
  const whole = nano / NANO;
  const frac = (nano % NANO).toString().padStart(9, "0");
  return `${whole.toString()}.${frac}`;
}

interface PoolView {
  poolId: string;
  stream: StreamState;
  org: string;
  orgName: string | null;
}

// One row per stream pool. Owns the live ticking balance + claim actions.
function StreamCard({
  view,
  vaultId,
  onWantInvest,
  onVaultChanged,
}: {
  view: PoolView;
  vaultId: string | null;
  onWantInvest: () => void;
  onVaultChanged: (id: string) => void;
}) {
  const account = useCurrentAccount();
  const wallet = account!.address;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { poolId, stream, org, orgName } = view;

  const [busy, setBusy] = useState(false);
  const live = !stream.paused && !stream.stopped;

  // ----- base claimable polled ~2s; interpolated locally between polls -----
  const claimQuery = useQuery({
    queryKey: ["claimable", poolId, wallet],
    refetchInterval: 2000,
    queryFn: async () => {
      const raw = await readClaimable(client, poolId, wallet).catch(() => 0n);
      return { raw, at: Date.now() };
    },
  });

  const baseRaw = claimQuery.data?.raw ?? 0n;
  const polledAt = claimQuery.data?.at; // undefined until first poll resolves

  // Ticking display string (USDC, 9 dp). Interpolated locally between polls in
  // EXACT bigint math (nano-USDC), refreshed every animation frame so the
  // low-order digits visibly churn. claimable_raw is 6dp → ×1000 = nano.
  const [display, setDisplay] = useState("0.000000000");
  useEffect(() => {
    const anchor = polledAt ?? Date.now();
    let raf = 0;
    const tick = () => {
      const elapsed = BigInt(Math.max(0, Date.now() - anchor));
      const accruedNano =
        live && stream.ratePeriodMs > 0n
          ? (stream.rateAmountRaw * 1000n * elapsed) / stream.ratePeriodMs
          : 0n;
      setDisplay(formatNano(baseRaw * 1000n + accruedNano));
      if (live) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [baseRaw, polledAt, live, stream.rateAmountRaw, stream.ratePeriodMs]);

  // ----- min-claim gate -----
  const minRaw = useMemo(
    () => minClaimRaw(stream.rateAmountRaw, stream.ratePeriodMs),
    [stream.rateAmountRaw, stream.ratePeriodMs],
  );
  const meetsMin = baseRaw >= minRaw && minRaw > 0n;
  // hours of accrual still needed to reach the min-claim floor
  const hoursToMin = useMemo(() => {
    const rawPerMs =
      stream.ratePeriodMs > 0n
        ? Number(stream.rateAmountRaw) / Number(stream.ratePeriodMs)
        : 0;
    if (meetsMin || rawPerMs <= 0) return 0;
    const remaining = Number(minRaw) - Number(baseRaw);
    if (remaining <= 0) return 0;
    return remaining / rawPerMs / 3_600_000;
  }, [meetsMin, minRaw, baseRaw, stream.rateAmountRaw, stream.ratePeriodMs]);

  // Decide which protocols to drain to cover the claim shortfall.
  async function computeCovers(): Promise<CoverOpts> {
    try {
      const [summary, inv] = await Promise.all([
        readPoolSummary(client, poolId),
        readPoolInvestments(client, poolId),
      ]);
      const claimable = await readClaimable(client, poolId, wallet).catch(
        () => baseRaw,
      );
      if (summary.idleRaw >= claimable) return { coverNavi: false, coverScallop: false };
      // pull from whatever has a position; covers self-cap to the shortfall
      return {
        coverNavi: inv.naviRaw > 0n,
        coverScallop: inv.scallopRaw > 0n,
      };
    } catch {
      return { coverNavi: false, coverScallop: false };
    }
  }

  async function handleWithdrawToWallet() {
    setBusy(true);
    const t = toast.loading("Preparing claim…");
    try {
      const covers = await computeCovers();
      toast.loading("Withdrawing to wallet…", { id: t });
      const { digest } = await signAndExecute({
        transaction: claimToWalletTx(poolId, covers),
      });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.success("Claimed to wallet", { id: t });
      await claimQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  // Ensure the caller has a vault with a USDC bucket; returns its id.
  async function ensureVault(): Promise<string> {
    let id = vaultId ?? (await findMyVault(client, wallet));
    if (!id) {
      toast.loading("Creating vault…");
      const created = await signAndExecute({ transaction: createVaultTx() });
      const res = await client.waitForTransaction({
        digest: created.digest,
        options: { showObjectChanges: true, showEffects: true },
      });
      id = findCreatedVaultId(res.objectChanges) ?? null;
      if (!id) throw new Error("Could not find created vault id");
      toast.loading("Initializing USDC bucket…");
      const initd = await signAndExecute({ transaction: initBucketTx(id) });
      await client.waitForTransaction({
        digest: initd.digest,
        options: { showEffects: true },
      });
      onVaultChanged(id);
    }
    return id;
  }

  async function handleWithdrawToVault() {
    setBusy(true);
    const t = toast.loading("Preparing vault claim…");
    try {
      const vid = await ensureVault();
      const covers = await computeCovers();
      toast.loading("Claiming into vault…", { id: t });
      const { digest } = await signAndExecute({
        transaction: claimToVaultTx(poolId, vid, covers),
      });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.success("Claimed into vault", { id: t });
      await claimQuery.refetch();
      onWantInvest();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

  const status = stream.stopped ? "Stopped" : stream.paused ? "Paused" : "Streaming";
  const statusVariant = stream.stopped
    ? "destructive"
    : stream.paused
      ? "secondary"
      : "default";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{orgName ?? short(org)}</CardTitle>
        <CardDescription>Pool {short(poolId)}</CardDescription>
        <CardAction>
          <Badge variant={statusVariant}>{status}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">Claimable now</p>
          <p className="font-mono text-3xl font-semibold tabular-nums">
            {display}{" "}
            <span className="text-base text-muted-foreground">USDC</span>
          </p>
          {!meetsMin && live && (
            <p className="text-xs text-muted-foreground">
              Withdraw unlocks in ~{hoursToMin.toFixed(1)}h (min-claim floor)
            </p>
          )}
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={handleWithdrawToWallet}
            disabled={busy || !meetsMin}
          >
            Withdraw to wallet
          </Button>
          <Button
            variant="outline"
            onClick={handleWithdrawToVault}
            disabled={busy || !meetsMin}
          >
            Withdraw to vault
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const EmployeePortal = () => {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const api = useSweemApi();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [vaultId, setVaultId] = useState<string | null>(null);

  // ----- chain-first stream discovery -----
  const poolsQuery = useQuery<PoolView[]>({
    queryKey: ["myStreams", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const ids = await findMyStreamPools(client, wallet!);
      const views = await Promise.all(
        ids.map(async (poolId): Promise<PoolView | null> => {
          const stream = await readStream(client, poolId, wallet!);
          if (!stream) return null;
          const org = await readPoolOrg(client, poolId);
          const orgName = org ? await api.getOrgName(org) : null;
          return { poolId, stream, org, orgName };
        }),
      );
      return views.filter((v): v is PoolView => v !== null);
    },
  });

  // ----- vault discovery (chain) -----
  const vaultQuery = useQuery<string | null>({
    queryKey: ["myVault", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: () => findMyVault(client, wallet!),
  });
  // vaultId is an optimistic override set right after on-chain vault creation;
  // otherwise the chain query is the source of truth.
  const effectiveVault = vaultId ?? vaultQuery.data ?? null;

  const vaultInvQuery = useQuery({
    queryKey: ["vaultInv", effectiveVault],
    enabled: !!effectiveVault,
    refetchInterval: 8000,
    queryFn: () => readVaultInvestments(client, effectiveVault!),
  });

  // ----- shared invest dialog state -----
  const [investOpen, setInvestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [naviYes, setNaviYes] = useState(true);
  const [scallopYes, setScallopYes] = useState(true);
  const [naviAmt, setNaviAmt] = useState("");
  const [scallopAmt, setScallopAmt] = useState("");
  const investIdleUsdc = vaultInvQuery.data
    ? fromRaw(vaultInvQuery.data.idleRaw)
    : 0;
  // re-fetch yields when the dialog opens (best-effort; never blocks)
  const yieldOpenedRef = useRef(false);
  useEffect(() => {
    if (investOpen && !yieldOpenedRef.current) {
      yieldOpenedRef.current = true;
      api.yieldsQuery.refetch().catch(() => {});
    }
    if (!investOpen) yieldOpenedRef.current = false;
  }, [investOpen, api.yieldsQuery]);

  const quotes = api.yieldsQuery.data?.quotes ?? [];
  const naviApy = quotes.find((q) => q.protocol === "NAVI")?.apy;
  const scallopApy = quotes.find((q) => q.protocol === "SCALLOP")?.apy;

  const naviNum = Number(naviAmt) || 0;
  const scallopNum = Number(scallopAmt) || 0;
  const investError = (() => {
    if (naviYes) {
      if (naviNum > investIdleUsdc) return "Navi exceeds vault idle balance";
      if (naviNum < NAVI_MIN_INVEST_USDC)
        return `Navi requires at least ${NAVI_MIN_INVEST_USDC} USDC`;
    }
    if (scallopYes && scallopNum > investIdleUsdc)
      return "Scallop exceeds vault idle balance";
    if (naviYes && scallopYes && naviNum + scallopNum > investIdleUsdc)
      return "Combined amount exceeds vault idle balance";
    if (!naviYes && !scallopYes) return "Select at least one protocol";
    return null;
  })();

  function openInvest() {
    setNaviAmt("");
    setScallopAmt("");
    setInvestOpen(true);
  }

  async function handleConfirmInvest() {
    if (!effectiveVault || investError) return;
    setBusy(true);
    const t = toast.loading("Investing vault funds…");
    try {
      if (naviYes && naviNum > 0) {
        const needsCap = !(await vaultHasNaviCap(client, effectiveVault));
        toast.loading("Investing into Navi…", { id: t });
        const r = await signAndExecute({
          transaction: vaultInvestNaviTx(effectiveVault, toRaw(naviNum), {
            needsCap,
          }),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true },
        });
      }
      if (scallopYes && scallopNum > 0) {
        toast.loading("Investing into Scallop…", { id: t });
        const r = await signAndExecute({
          transaction: vaultInvestScallopTx(effectiveVault, toRaw(scallopNum)),
        });
        await client.waitForTransaction({
          digest: r.digest,
          options: { showEffects: true },
        });
      }
      toast.success("Vault funds invested", { id: t });
      setInvestOpen(false);
      await vaultInvQuery.refetch();
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
          <CardTitle>Employee portal</CardTitle>
          <CardDescription>Connect a wallet to view your streams.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const pools = poolsQuery.data ?? [];
  const vinv = vaultInvQuery.data;

  return (
    <div className="flex flex-col gap-6">
      {/* Streams */}
      {poolsQuery.isLoading ? (
        <Card>
          <CardHeader>
            <CardDescription>Scanning chain for your streams…</CardDescription>
          </CardHeader>
        </Card>
      ) : pools.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No streams</CardTitle>
            <CardDescription>No streams found for your wallet.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pools.map((v) => (
            <StreamCard
              key={v.poolId}
              view={v}
              vaultId={effectiveVault}
              onWantInvest={openInvest}
              onVaultChanged={(id) => setVaultId(id)}
            />
          ))}
        </div>
      )}

      {/* Vault */}
      {effectiveVault && (
        <Card>
          <CardHeader>
            <CardTitle>Vault</CardTitle>
            <CardDescription>{short(effectiveVault)}</CardDescription>
            <CardAction>
              <Button
                variant="outline"
                onClick={openInvest}
                disabled={busy || investIdleUsdc <= 0}
              >
                Invest more
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <Stat
                label="Idle (USDC)"
                value={`${fromRaw(vinv?.idleRaw ?? 0n).toFixed(2)}`}
              />
              <Stat
                label="In Navi"
                value={`${fromRaw(vinv?.naviRaw ?? 0n).toFixed(2)}`}
              />
              <Stat
                label="In Scallop"
                value={`${fromRaw(vinv?.scallopRaw ?? 0n).toFixed(2)}`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invest dialog (reused for post-claim + invest-more) */}
      <Dialog open={investOpen} onOpenChange={setInvestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invest vault funds</DialogTitle>
            <DialogDescription>
              Earn yield on idle USDC in your vault. Available now:{" "}
              {investIdleUsdc.toFixed(2)} USDC.
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
            {investError && (
              <p className="text-sm text-destructive">{investError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInvestOpen(false)}>
              Skip
            </Button>
            <Button
              onClick={handleConfirmInvest}
              disabled={busy || !!investError}
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

export default EmployeePortal;
