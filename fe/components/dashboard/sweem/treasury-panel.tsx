"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, TrendingUp } from "lucide-react";
import { TokenTabs } from "./token-tabs";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { useSweemApi } from "@/lib/api";
import { TOKENS, fromRaw, toRaw, type TokenSymbol } from "@/lib/tokens";
import {
  createVaultTx,
  treasuryInvestTx,
  vaultWithdrawNaviTx,
  vaultWithdrawScallopTx,
  withdrawToWalletTx,
  readVaultInvestments,
  findMyVault,
  vaultHasBucket,
  vaultHasNaviCap,
  type YieldProtocol,
} from "@/lib/tx";
import { cn } from "@/lib/utils";

interface Positions {
  idle: number;
  navi: number;
  scallop: number;
}

// Protocols we can route into today (deployed adapters) vs. coming soon (logos shown
// for completeness but not yet selectable).
const LIVE_PROTOCOLS: { id: YieldProtocol; label: string }[] = [
  { id: "navi", label: "Navi" },
  { id: "scallop", label: "Scallop" },
];
const protoLabel = (p: YieldProtocol) => (p === "navi" ? "Navi" : "Scallop");
const SOON_PROTOCOLS: { label: string; logo: string }[] = [
  { label: "Suilend", logo: "https://unavatar.io/suilend.fi" },
  { label: "Ondo", logo: "https://unavatar.io/ondo.finance" },
  { label: "AlphaFi", logo: "https://unavatar.io/alphafi.xyz" },
];

export function TreasuryPanel() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const api = useSweemApi();

  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const token = TOKENS[symbol];

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [pos, setPos] = useState<Positions>({ idle: 0, navi: 0, scallop: 0 });
  const [walletBal, setWalletBal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState("");
  const [protocols, setProtocols] = useState<YieldProtocol[]>(["navi"]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(-1); // last wallet balance we auto-invested, prevents loops

  const toggleProtocol = (p: YieldProtocol) =>
    setProtocols((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  // Close the protocol dropdown on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Persist the auto-invest preference per token.
  useEffect(() => {
    setAuto(localStorage.getItem(`sweem.treasury.auto.${symbol}`) === "1");
  }, [symbol]);
  const toggleAuto = (v: boolean) => {
    setAuto(v);
    localStorage.setItem(`sweem.treasury.auto.${symbol}`, v ? "1" : "0");
  };

  const apyOf = (p: YieldProtocol) => {
    const q = api.yieldsByToken.data?.[symbol]?.quotes ?? [];
    return q.find((x) => x.protocol === (p === "navi" ? "NAVI" : "SCALLOP"))?.apy;
  };

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const [vid, bal] = await Promise.all([
        findMyVault(client, wallet),
        client.getBalance({ owner: wallet, coinType: token.coinType }),
      ]);
      setVaultId(vid);
      setWalletBal(fromRaw(token, BigInt(bal.totalBalance)));
      if (vid) {
        const inv = await readVaultInvestments(client, vid, token);
        setPos({
          idle: fromRaw(token, inv.idleRaw),
          navi: fromRaw(token, inv.naviRaw),
          scallop: fromRaw(token, inv.scallopRaw),
        });
      } else {
        setPos({ idle: 0, navi: 0, scallop: 0 });
      }
    } catch {
      /* best effort */
    } finally {
      setLoading(false);
    }
  }, [wallet, client, token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Ensure the caller owns a vault; create one if missing and return its id.
  const ensureVault = async (): Promise<string> => {
    if (vaultId) return vaultId;
    const res = await signAndExecute({ transaction: createVaultTx() });
    await client.waitForTransaction({ digest: res.digest });
    const vid = await findMyVault(client, wallet!);
    if (!vid) throw new Error("Vault creation failed");
    setVaultId(vid);
    return vid;
  };

  const doDeposit = useCallback(
    async (amt: number, isAuto = false) => {
      if (!wallet) {
        if (!isAuto) toast.error("Connect a wallet");
        return;
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        if (!isAuto) toast.error("Enter an amount");
        return;
      }
      if (amt > walletBal) {
        if (!isAuto) toast.error("Amount exceeds wallet balance");
        return;
      }
      const sel = protocols;
      if (sel.length === 0) {
        if (!isAuto) toast.error("Select at least one protocol");
        return;
      }
      // Split the deposit evenly across the selected protocols.
      const share = amt / sel.length;
      if (sel.includes("navi") && share < token.navi.minInvest) {
        if (!isAuto)
          toast.error(
            sel.length > 1
              ? `Each Navi split needs ${token.navi.minInvest} ${symbol} (deposit at least ${token.navi.minInvest * sel.length})`
              : `Navi requires at least ${token.navi.minInvest} ${symbol}`
          );
        return;
      }

      setBusy(true);
      const t = toast.loading(isAuto ? "Auto-investing received funds…" : "Preparing…");
      try {
        const vid = await ensureVault();
        for (const p of sel) {
          const needsBucket = !(await vaultHasBucket(client, vid, token));
          const needsNaviCap = p === "navi" && !(await vaultHasNaviCap(client, vid, token));
          toast.loading(`Depositing into ${protoLabel(p)}…`, { id: t });
          const res = await signAndExecute({
            transaction: treasuryInvestTx({
              vaultId: vid,
              token,
              protocol: p,
              amountRaw: toRaw(token, share),
              needsBucket,
              needsNaviCap,
            }),
          });
          await client.waitForTransaction({ digest: res.digest });
        }
        toast.success(`Earning yield on ${amt} ${symbol}`, { id: t });
        setAmount("");
        await refresh();
      } catch (e) {
        toast.error((e as Error).message, { id: t });
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet, walletBal, protocols, token, symbol, client]
  );

  const deposit = () => doDeposit(Number(amount));

  // Auto-invest: when enabled, sweep newly received wallet funds into the chosen
  // protocol once per balance change (each sweep still asks the wallet to sign).
  useEffect(() => {
    if (!auto || busy || loading || !wallet || protocols.length === 0) return;
    const min = protocols.includes("navi") ? token.navi.minInvest * protocols.length : 0.000001;
    if (walletBal < min) return;
    if (autoRef.current === walletBal) return; // already handled this balance
    autoRef.current = walletBal;
    doDeposit(walletBal, true);
  }, [auto, busy, loading, wallet, walletBal, protocols, token, doDeposit]);

  const withdrawProtocol = async (p: YieldProtocol) => {
    if (!vaultId) return;
    const invested = p === "navi" ? pos.navi : pos.scallop;
    if (invested <= 0) return;
    setBusy(true);
    const t = toast.loading(`Withdrawing from ${p === "navi" ? "Navi" : "Scallop"}…`);
    try {
      const tx = p === "navi" ? vaultWithdrawNaviTx(vaultId, toRaw(token, invested), token) : vaultWithdrawScallopTx(vaultId, toRaw(token, invested), token);
      const res = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: res.digest });
      toast.success("Moved to vault balance", { id: t });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  const withdrawIdleToWallet = async () => {
    if (!vaultId || pos.idle <= 0 || !wallet) return;
    setBusy(true);
    const t = toast.loading("Withdrawing to wallet…");
    try {
      const res = await signAndExecute({
        transaction: withdrawToWalletTx(vaultId, toRaw(token, pos.idle), wallet, token),
      });
      await client.waitForTransaction({ digest: res.digest });
      toast.success("Withdrawn to wallet", { id: t });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  if (!wallet) return null;

  return (
    <div className="mt-8 rounded-[20px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--sw-text)]">
            <TrendingUp className="size-[18px] text-[var(--sw-mint)]" strokeWidth={2.2} />
            Earn yield on received payments
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            Route funds received at your wallet into Navi or Scallop and earn yield until you cash out.
          </p>
        </div>
        <TokenTabs value={symbol} onChange={setSymbol} layoutId="treasuryTab" />
      </div>

      {/* Balances */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <BalanceCard label="Wallet" value={walletBal} token={symbol} />
        <BalanceCard label="Idle in vault" value={pos.idle} token={symbol} />
        <BalanceCard label="Navi" value={pos.navi} token={symbol} apy={apyOf("navi")} protocol="navi" />
        <BalanceCard label="Scallop" value={pos.scallop} token={symbol} apy={apyOf("scallop")} protocol="scallop" />
      </div>

      {/* Deposit */}
      <div className="mt-4 rounded-2xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--sw-text-muted)]">Deposit to yield</p>
          <button
            type="button"
            onClick={() => toggleAuto(!auto)}
            className="flex items-center gap-2 text-[12px] font-medium text-[var(--sw-text-muted)]"
            title="Automatically route received funds into the selected protocol"
          >
            Auto-invest
            <span
              className={cn(
                "relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors",
                auto ? "bg-[var(--sw-mint)]" : "bg-[var(--sw-border-strong)]"
              )}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform",
                  auto ? "translate-x-4" : "translate-x-0"
                )}
              />
            </span>
          </button>
        </div>
        {auto && (
          <p className="mt-1.5 text-[11.5px] text-[var(--sw-text-dim)]">
            New {symbol} received at your wallet is swept into{" "}
            {protocols.map(protoLabel).join(" & ") || "the selected protocol"} automatically (each sweep asks you to sign).
          </p>
        )}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold tabular-nums text-[var(--sw-text)] outline-none placeholder:font-normal placeholder:text-[var(--sw-text-muted)]"
            />
            <button
              type="button"
              onClick={() => setAmount(String(walletBal))}
              className="shrink-0 rounded-md bg-[var(--sw-card-inset)] px-2 py-1 text-[11px] font-medium text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
            >
              Max
            </button>
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[var(--sw-text)]">
              <TokenIcon token={token} size={15} />
              {symbol}
            </span>
          </div>
          {/* protocol selector — multi-select dropdown */}
          <div className="relative sm:w-[200px]" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 text-[13px] font-medium text-[var(--sw-text)] transition-colors hover:border-[var(--sw-border-strong)]"
            >
              {protocols.length > 0 ? (
                <span className="flex -space-x-1.5">
                  {protocols.map((p) => (
                    <ProtocolLogo key={p} name={p} size={18} className="ring-2 ring-[#1b1b1f]" />
                  ))}
                </span>
              ) : null}
              <span className="flex-1 truncate text-left">
                {protocols.length === 0
                  ? "Select protocol"
                  : protocols.map(protoLabel).join(", ")}
              </span>
              <ChevronDown
                className={cn("size-4 shrink-0 text-[var(--sw-text-muted)] transition-transform", pickerOpen && "rotate-180")}
              />
            </button>

            {pickerOpen && (
              <div className="absolute bottom-full right-0 z-20 mb-1.5 w-full min-w-[200px] rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card)] p-1.5 shadow-[0_-12px_32px_rgba(0,0,0,0.5)]">
                {LIVE_PROTOCOLS.map(({ id, label }) => {
                  const checked = protocols.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleProtocol(id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition-colors hover:bg-[var(--sw-card-inset)]"
                    >
                      <ProtocolLogo name={id} size={18} />
                      <span className="flex-1 text-left text-[var(--sw-text)]">{label}</span>
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
                          checked ? "border-[var(--sw-mint)] bg-[var(--sw-mint)]" : "border-[var(--sw-border-strong)]"
                        )}
                      >
                        {checked && <Check className="size-3 text-black" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
                <div className="my-1 h-px bg-[var(--sw-border)]" />
                {SOON_PROTOCOLS.map(({ label, logo }) => (
                  <div
                    key={label}
                    title={`${label} — coming soon`}
                    className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logo}
                      alt=""
                      className={cn(
                        "size-[18px] shrink-0 rounded-full object-cover",
                        logo.includes("ondo") ? "[filter:brightness(0)_invert(1)]" : "bg-white"
                      )}
                    />
                    <span className="flex-1 text-left text-[var(--sw-text-dim)]">{label}</span>
                    <span className="rounded bg-[var(--sw-card-inset)] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-[var(--sw-text-muted)]">
                      Soon
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={deposit}
            disabled={busy || loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Deposit
          </button>
        </div>
      </div>

      {/* Withdraw actions */}
      {(pos.navi > 0 || pos.scallop > 0 || pos.idle > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pos.navi > 0 && (
            <WithdrawChip label={`Withdraw ${pos.navi.toFixed(2)} from Navi`} onClick={() => withdrawProtocol("navi")} disabled={busy} />
          )}
          {pos.scallop > 0 && (
            <WithdrawChip label={`Withdraw ${pos.scallop.toFixed(2)} from Scallop`} onClick={() => withdrawProtocol("scallop")} disabled={busy} />
          )}
          {pos.idle > 0 && (
            <WithdrawChip label={`Send ${pos.idle.toFixed(2)} ${symbol} to wallet`} onClick={withdrawIdleToWallet} disabled={busy} primary />
          )}
        </div>
      )}
    </div>
  );
}

function BalanceCard({
  label,
  value,
  token,
  apy,
  protocol,
}: {
  label: string;
  value: number;
  token: TokenSymbol;
  apy?: number;
  protocol?: YieldProtocol;
}) {
  return (
    <div className="rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--sw-text-dim)]">
        {protocol ? <ProtocolLogo name={protocol} size={14} /> : <TokenIcon token={TOKENS[token]} size={14} />}
        {label}
        {apy != null && <span className="ml-auto text-[var(--sw-mint)]">{apy.toFixed(2)}%</span>}
      </div>
      <p className="mt-1.5 text-[18px] font-semibold tabular-nums text-[var(--sw-text)]">{value.toFixed(2)}</p>
    </div>
  );
}

function WithdrawChip({ label, onClick, disabled, primary }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "border-[var(--sw-mint)]/40 bg-[rgba(196,245,107,0.1)] text-[var(--sw-mint)] hover:bg-[rgba(196,245,107,0.16)]"
          : "border-[var(--sw-border)] text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
      )}
    >
      {label}
    </button>
  );
}
