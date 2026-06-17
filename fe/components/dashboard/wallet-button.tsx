"use client";

import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Connect / disconnect control for the dashboard navbar. Reuses the existing
// `dashboard-top-action` styling so it sits inline with Support / Feedback.
export function WalletButton() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();

  if (account) {
    return (
      <button
        className="dashboard-top-action"
        onClick={() => disconnect()}
        title="Disconnect wallet"
        type="button"
      >
        <span className="sweem-dot" aria-hidden="true" />
        <span className="font-mono">{shortAddr(account.address)}</span>
      </button>
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
