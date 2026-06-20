"use client";

import { useState } from "react";
import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { toast } from "sonner";

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Deterministic gradient avatar derived from the address.
function avatarStyle(addr: string): React.CSSProperties {
  const h1 = parseInt(addr.slice(2, 8), 16) % 360;
  const h2 = parseInt(addr.slice(-6), 16) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1} 72% 56%), hsl(${h2} 72% 46%))`,
  };
}

export function WalletButton() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  const [copied, setCopied] = useState(false);

  if (account) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(account.address);
        setCopied(true);
        toast.success("Address copied");
        setTimeout(() => setCopied(false), 1400);
      } catch {
        toast.error("Couldn't copy address");
      }
    };

    return (
      <div className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card)] pl-1.5 pr-1">
        <span
          className="size-6 shrink-0 rounded-full"
          style={avatarStyle(account.address)}
          aria-hidden="true"
        />
        <button
          onClick={copy}
          title="Copy full address"
          type="button"
          className="flex items-center gap-1.5 rounded-full px-1.5 py-1 font-mono text-[12.5px] font-medium text-[var(--sw-text)] transition-colors hover:text-[var(--sw-mint)]"
        >
          <span>{shortAddr(account.address)}</span>
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12.5 9.5 17 19 6.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
              <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <span className="h-4 w-px bg-[var(--sw-border)]" aria-hidden="true" />
        <button
          onClick={() => disconnect()}
          title="Disconnect wallet"
          type="button"
          className="flex size-7 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[rgba(239,68,68,0.12)] hover:text-[#ef4444]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 12H5m0 0 4-4m-4 4 4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <ConnectModal
      trigger={
        <button
          type="button"
          className="rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
        >
          Connect wallet
        </button>
      }
    />
  );
}
