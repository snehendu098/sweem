"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Loader2, TrendingUp } from "lucide-react";
import { TokenTabs } from "./token-tabs";
import { SlippageInput } from "./ui";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { useSweemApi } from "@/lib/api";
import { TOKENS, fromRaw, toRaw, type TokenSymbol } from "@/lib/tokens";
import { protocolsForScope, minInvestFor, type ProtocolKey } from "@/lib/protocols";
import {
  createVaultTx,
  treasuryInvestTx,
  vaultWithdrawNaviTx,
  vaultWithdrawScallopTx,
  vaultWithdrawSuilendTx,
  vaultWithdrawStsuiTx,
  vaultWithdrawUsdyTx,
  withdrawToWalletTx,
  readVaultInvestments,
  findMyVault,
  vaultHasBucket,
  vaultHasNaviCap,
  DEFAULT_USDY_SLIPPAGE_BPS,
} from "@/lib/tx";
import { cn } from "@/lib/utils";

// Invested principal per protocol (human units) + idle + the custodied USDY balance.
type Positions = Record<ProtocolKey, number> & { idle: number; usdyHeldY: number };
const ZERO_POS: Positions = { navi: 0, scallop: 0, suilend: 0, usdy: 0, stsui: 0, idle: 0, usdyHeldY: 0 };

export function TreasuryPanel() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const api = useSweemApi();

  const [symbol, setSymbol] = useState<TokenSymbol>("USDC");
  const token = TOKENS[symbol];

  // Protocols available for a personal vault in this token (L/Y/S, scope-filtered).
  const protocols = useMemo(() => protocolsForScope("vault", token), [token]);

  const [vaultId, setVaultId] = useState<string | null>(null);
  const [pos, setPos] = useState<Positions>(ZERO_POS);
  const [walletBal, setWalletBal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState("");
  const [protocol, setProtocol] = useState<ProtocolKey>("navi");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_USDY_SLIPPAGE_BPS);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(-1); // last wallet balance we auto-invested, prevents loops

  // Keep the selected protocol valid as the token (and thus the protocol set) changes.
  useEffect(() => {
    if (!protocols.some((p) => p.key === protocol)) setProtocol(protocols[0].key);
  }, [protocols, protocol]);

  const selected = protocols.find((p) => p.key === protocol) ?? protocols[0];
  const isUsdy = selected?.key === "usdy";

  // Persist the auto-invest preference per token.
  useEffect(() => {
    setAuto(localStorage.getItem(`sweem.treasury.auto.${symbol}`) === "1");
  }, [symbol]);
  const toggleAuto = (v: boolean) => {
    setAuto(v);
    localStorage.setItem(`sweem.treasury.auto.${symbol}`, v ? "1" : "0");
  };

  const apyOf = (key: ProtocolKey) => {
    const enumKey = protocols.find((p) => p.key === key)?.apyEnum;
    const q = api.yieldsByToken.data?.[symbol]?.quotes ?? [];
    return q.find((x) => x.protocol === enumKey)?.apy;
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
          navi: fromRaw(token, inv.naviRaw),
          scallop: fromRaw(token, inv.scallopRaw),
          suilend: fromRaw(token, inv.suilendRaw),
          usdy: fromRaw(token, inv.usdyRaw),
          stsui: fromRaw(token, inv.stsuiRaw),
          idle: fromRaw(token, inv.idleRaw),
          usdyHeldY: fromRaw(token, inv.usdyHeldYRaw),
        });
      } else {
        setPos(ZERO_POS);
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
      const min = minInvestFor(protocol, token);
      if (amt < min) {
        if (!isAuto) toast.error(`${selected.label} requires at least ${min} ${symbol}`);
        return;
      }

      setBusy(true);
      const t = toast.loading(isAuto ? "Auto-investing received funds…" : "Preparing…");
      try {
        const vid = await ensureVault();
        const needsBucket = !(await vaultHasBucket(client, vid, token));
        const needsNaviCap = protocol === "navi" && !(await vaultHasNaviCap(client, vid, token));
        toast.loading(`Depositing into ${selected.label}…`, { id: t });
        const transaction = await treasuryInvestTx({
          vaultId: vid,
          token,
          protocol,
          amountRaw: toRaw(token, amt),
          needsBucket,
          needsNaviCap,
          slippageBps,
        });
        const res = await signAndExecute({ transaction });
        await client.waitForTransaction({ digest: res.digest });
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
    [wallet, walletBal, protocol, token, symbol, client, slippageBps, selected]
  );

  const deposit = () => doDeposit(Number(amount));

  // Auto-invest: when enabled, sweep newly received wallet funds into the chosen
  // protocol once per balance change (each sweep still asks the wallet to sign).
  useEffect(() => {
    if (!auto || busy || loading || !wallet) return;
    const min = Math.max(minInvestFor(protocol, token), 0.000001);
    if (walletBal < min) return;
    if (autoRef.current === walletBal) return; // already handled this balance
    autoRef.current = walletBal;
    doDeposit(walletBal, true);
  }, [auto, busy, loading, wallet, walletBal, protocol, token, doDeposit]);

  // Move an invested position back into the vault's idle bucket balance.
  const withdrawProtocol = async (key: ProtocolKey) => {
    if (!vaultId) return;
    const invested = pos[key];
    if (invested <= 0) return;
    const label = protocols.find((p) => p.key === key)?.label ?? key;
    setBusy(true);
    const t = toast.loading(`Withdrawing from ${label}…`);
    try {
      let transaction;
      if (key === "navi") transaction = vaultWithdrawNaviTx(vaultId, toRaw(token, invested), token);
      else if (key === "scallop") transaction = vaultWithdrawScallopTx(vaultId, toRaw(token, invested), token);
      else if (key === "suilend") transaction = vaultWithdrawSuilendTx(vaultId, token); // full position
      else if (key === "stsui") transaction = vaultWithdrawStsuiTx(vaultId); // full position
      else transaction = await vaultWithdrawUsdyTx(vaultId, toRaw(token, pos.usdyHeldY), token, slippageBps); // full Y
      const res = await signAndExecute({ transaction });
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

  const hasPositions = protocols.some((p) => pos[p.key] > 0) || pos.idle > 0;

  return (
    <div className="mt-8 rounded-[20px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--sw-text)]">
            <TrendingUp className="size-[18px] text-[var(--sw-mint)]" strokeWidth={2.2} />
            Earn yield on received payments
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            Route funds received at your wallet into a lending (L), yield-bearing (Y), or staking (S)
            protocol and earn until you cash out.
          </p>
        </div>
        <TokenTabs value={symbol} onChange={setSymbol} layoutId="treasuryTab" />
      </div>

      {/* Balances */}
      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <BalanceCard label="Wallet" value={walletBal} token={symbol} />
        <BalanceCard label="Idle in vault" value={pos.idle} token={symbol} />
        {protocols.map((p) => (
          <BalanceCard
            key={p.key}
            label={p.label}
            value={pos[p.key]}
            token={symbol}
            apy={apyOf(p.key)}
            protocol={p.key}
          />
        ))}
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
            New {symbol} received at your wallet is swept into {selected?.label} automatically (each sweep asks you to sign).
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
          <div className="flex flex-wrap gap-2">
            {protocols.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setProtocol(p.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors",
                  protocol === p.key
                    ? "border-[var(--sw-border-strong)] bg-[var(--sw-card)] text-[var(--sw-text)]"
                    : "border-[var(--sw-border)] text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
                )}
              >
                <ProtocolLogo name={p.key} size={18} />
                {p.label}
              </button>
            ))}
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
        {isUsdy && (
          <div className="mt-3">
            <SlippageInput bps={slippageBps} onBps={setSlippageBps} disabled={busy} />
          </div>
        )}
      </div>

      {/* Withdraw actions */}
      {hasPositions && (
        <div className="mt-3 flex flex-wrap gap-2">
          {protocols
            .filter((p) => pos[p.key] > 0)
            .map((p) => (
              <WithdrawChip
                key={p.key}
                label={`Withdraw ${pos[p.key].toFixed(2)} from ${p.label}`}
                onClick={() => withdrawProtocol(p.key)}
                disabled={busy}
              />
            ))}
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
  protocol?: ProtocolKey;
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
