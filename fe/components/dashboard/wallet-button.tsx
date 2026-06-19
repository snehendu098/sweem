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

// Deterministic gradient avatar derived from the address, so each wallet gets a
// stable, recognizable color identity.
function avatarStyle(addr: string): React.CSSProperties {
  const h1 = parseInt(addr.slice(2, 8), 16) % 360;
  const h2 = parseInt(addr.slice(-6), 16) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1} 72% 56%), hsl(${h2} 72% 46%))`,
  };
}

// Connect / wallet-chip control for the dashboard navbar.
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
      <div className="dashboard-wallet-chip">
        <span
          className="dashboard-wallet-avatar"
          style={avatarStyle(account.address)}
          aria-hidden="true"
        />
        <button
          className="dashboard-wallet-addr"
          onClick={copy}
          title="Copy full address"
          type="button"
        >
          <span className="font-mono">{shortAddr(account.address)}</span>
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12.5 9.5 17 19 6.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
              <path
                d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
        <span className="dashboard-wallet-divider" aria-hidden="true" />
        <button
          className="dashboard-wallet-iconbtn"
          onClick={() => disconnect()}
          title="Disconnect wallet"
          type="button"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 12H5m0 0 4-4m-4 4 4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <ConnectModal
      trigger={
        <button className="dashboard-screen-action dashboard-screen-action-primary" type="button">
          Connect wallet
        </button>
      }
    />
  );
}
