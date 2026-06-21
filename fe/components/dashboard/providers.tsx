"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import "@mysten/dapp-kit/dist/index.css";

type SuiNetwork = "mainnet" | "testnet" | "devnet";

const { networkConfig } = createNetworkConfig({
  mainnet: { url: getJsonRpcFullnodeUrl("mainnet"), network: "mainnet" },
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" },
  devnet: { url: getJsonRpcFullnodeUrl("devnet"), network: "devnet" },
});

// RPC network is driven by NEXT_PUBLIC_NETWORK (default mainnet). `||` (not `??`)
// so an empty value also falls back. NOTE: the Sweem package/object IDs in
// lib/sweem.ts are mainnet-deployed, keep this mainnet unless you repoint them.
const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "mainnet") as SuiNetwork;

// Scopes the Sui wallet + react-query context to the dashboard only, the
// marketing site under `/` stays a plain presentational tree.
export function DashboardProviders({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session (avoid re-creating across renders).
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={DEFAULT_NETWORK}>
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
