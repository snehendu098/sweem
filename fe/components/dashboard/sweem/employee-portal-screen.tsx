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
import { fromRaw, toRaw, minClaimRaw, NAVI_MIN_INVEST_USDC } from "@/lib/sweem";
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
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { LiveTicker } from "./live-ticker";
import { Stat, ActionButton, Modal, ProtocolRow, ConnectGate } from "./ui";
import { shortAddr } from "./helpers";

interface PoolView {
  poolId: string;
  stream: StreamState;
  org: string;
  orgName: string | null;
}

// One card per stream pool. Owns the live ticking balance + claim actions.
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

  const claimQuery = useQuery({
    queryKey: ["claimable", poolId, wallet],
    refetchInterval: 2000,
    queryFn: async () => {
      const raw = await readClaimable(client, poolId, wallet).catch(() => 0n);
      return { raw, at: Date.now() };
    },
  });

  const baseRaw = claimQuery.data?.raw ?? 0n;
  const polledAt = claimQuery.data?.at;

  const minRaw = useMemo(
    () => minClaimRaw(stream.rateAmountRaw, stream.ratePeriodMs),
    [stream.rateAmountRaw, stream.ratePeriodMs],
  );
  const meetsMin = baseRaw >= minRaw && minRaw > 0n;
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

  async function computeCovers(): Promise<CoverOpts> {
    try {
      const [summary, inv] = await Promise.all([
        readPoolSummary(client, poolId),
        readPoolInvestments(client, poolId),
      ]);
      const claimable = await readClaimable(client, poolId, wallet).catch(() => baseRaw);
      if (summary.idleRaw >= claimable) return { coverNavi: false, coverScallop: false };
      return { coverNavi: inv.naviRaw > 0n, coverScallop: inv.scallopRaw > 0n };
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
      const { digest } = await signAndExecute({ transaction: claimToWalletTx(poolId, covers) });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.success("Claimed to wallet", { id: t });
      await claimQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  }

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
      await client.waitForTransaction({ digest: initd.digest, options: { showEffects: true } });
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
      const { digest } = await signAndExecute({ transaction: claimToVaultTx(poolId, vid, covers) });
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
  const badgeClass = stream.stopped
    ? "sweem-badge-stopped"
    : stream.paused
      ? "sweem-badge-paused"
      : "sweem-badge-live";

  return (
    <div className="sweem-card">
      <div className="sweem-card-head">
        <div>
          <p className="sweem-card-title">{orgName ?? shortAddr(org)}</p>
          <p className="sweem-card-sub">Pool {shortAddr(poolId)}</p>
        </div>
        <span className={`sweem-badge ${badgeClass}`}>{status}</span>
      </div>

      <p className="sweem-stat-label">Claimable now</p>
      <p className="sweem-mono text-3xl font-semibold mt-1">
        <LiveTicker
          baseRaw={baseRaw}
          rateRaw={stream.rateAmountRaw}
          periodMs={stream.ratePeriodMs}
          anchorAt={polledAt}
          active={live}
        />{" "}
        <span className="text-base text-[color:var(--dash-faint)]">USDC</span>
      </p>
      {!meetsMin && live && (
        <p className="sweem-hint mt-1">
          Withdraw unlocks in ~{hoursToMin.toFixed(1)}h (min-claim floor)
        </p>
      )}

      <div className="sweem-actions mt-5">
        <ActionButton variant="primary" onClick={handleWithdrawToWallet} disabled={busy || !meetsMin}>
          Withdraw to wallet
        </ActionButton>
        <ActionButton onClick={handleWithdrawToVault} disabled={busy || !meetsMin}>
          Withdraw to vault
        </ActionButton>
      </div>
    </div>
  );
}

export function EmployeePortalScreen() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const api = useSweemApi();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [vaultId, setVaultId] = useState<string | null>(null);

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

  const vaultQuery = useQuery<string | null>({
    queryKey: ["myVault", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: () => findMyVault(client, wallet!),
  });
  const effectiveVault = vaultId ?? vaultQuery.data ?? null;

  const vaultInvQuery = useQuery({
    queryKey: ["vaultInv", effectiveVault],
    enabled: !!effectiveVault,
    refetchInterval: 8000,
    queryFn: () => readVaultInvestments(client, effectiveVault!),
  });

  const [investOpen, setInvestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [naviYes, setNaviYes] = useState(true);
  const [scallopYes, setScallopYes] = useState(true);
  const [naviAmt, setNaviAmt] = useState("");
  const [scallopAmt, setScallopAmt] = useState("");
  const investIdleUsdc = vaultInvQuery.data ? fromRaw(vaultInvQuery.data.idleRaw) : 0;

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
      if (naviNum < NAVI_MIN_INVEST_USDC) return `Navi requires at least ${NAVI_MIN_INVEST_USDC} USDC`;
    }
    if (scallopYes && scallopNum > investIdleUsdc) return "Scallop exceeds vault idle balance";
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
          transaction: vaultInvestNaviTx(effectiveVault, toRaw(naviNum), { needsCap }),
        });
        await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
      }
      if (scallopYes && scallopNum > 0) {
        toast.loading("Investing into Scallop…", { id: t });
        const r = await signAndExecute({
          transaction: vaultInvestScallopTx(effectiveVault, toRaw(scallopNum)),
        });
        await client.waitForTransaction({ digest: r.digest, options: { showEffects: true } });
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

  if (!wallet) {
    return (
      <DashboardPageShell title="Employee portal">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to view and claim your salary streams." />
        </div>
      </DashboardPageShell>
    );
  }

  const pools = poolsQuery.data ?? [];
  const vinv = vaultInvQuery.data;

  return (
    <DashboardPageShell
      title="Employee portal"
      subtitle="Claim your streamed salary and route it into a personal yield vault."
    >
      {/* streams */}
      {poolsQuery.isLoading ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="Scanning chain for your streams…" />
        </div>
      ) : pools.length === 0 ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="No streams found for your wallet." />
        </div>
      ) : (
        <div className="grid gap-4 mt-5 md:grid-cols-2">
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

      {/* vault */}
      {effectiveVault && (
        <div className="sweem-card mt-5">
          <div className="sweem-card-head">
            <div>
              <p className="sweem-card-title">Vault</p>
              <p className="sweem-card-sub">{shortAddr(effectiveVault)}</p>
            </div>
            <ActionButton onClick={openInvest} disabled={busy || investIdleUsdc <= 0}>
              Invest more
            </ActionButton>
          </div>
          <div className="sweem-grid sweem-grid-3">
            <Stat label="Idle (USDC)" value={fromRaw(vinv?.idleRaw ?? 0n).toFixed(2)} />
            <Stat label="In Navi" value={fromRaw(vinv?.naviRaw ?? 0n).toFixed(2)} />
            <Stat label="In Scallop" value={fromRaw(vinv?.scallopRaw ?? 0n).toFixed(2)} />
          </div>
        </div>
      )}

      {/* invest dialog */}
      <Modal
        open={investOpen}
        onClose={() => setInvestOpen(false)}
        title="Invest vault funds"
        subtitle={<>Earn yield on idle USDC in your vault. Available now: {investIdleUsdc.toFixed(2)} USDC.</>}
        footer={
          <>
            <ActionButton onClick={() => setInvestOpen(false)}>Skip</ActionButton>
            <ActionButton variant="primary" onClick={handleConfirmInvest} disabled={busy || !!investError}>
              Invest
            </ActionButton>
          </>
        }
      >
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
        {investError && <p className="sweem-error">{investError}</p>}
      </Modal>
    </DashboardPageShell>
  );
}
