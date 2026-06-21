"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
  type ThemeVars,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import "@mysten/dapp-kit/dist/index.css";

type SuiNetwork = "mainnet" | "testnet" | "devnet";

// Dark wallet-connect modal styled to match the Sweem dashboard palette
// (card #1a1a1c, inset #131316, mint #c4f56b). dapp-kit only ships a light
// theme, so we define the full contract here.
const sweemDarkTheme: ThemeVars = {
  blurs: {
    modalOverlay: "blur(0)",
  },
  backgroundColors: {
    primaryButton: "#26262b",
    primaryButtonHover: "#2f2f35",
    outlineButtonHover: "#1f1f24",
    modalOverlay: "rgba(0, 0, 0, 0.6)",
    modalPrimary: "#1a1a1c",
    modalSecondary: "#131316",
    iconButton: "transparent",
    iconButtonHover: "#26262b",
    dropdownMenu: "#1a1a1c",
    dropdownMenuSeparator: "#26262b",
    walletItemSelected: "#131316",
    walletItemHover: "#26262b",
  },
  borderColors: {
    outlineButton: "#2a2a2e",
  },
  colors: {
    primaryButton: "#f4f4f5",
    outlineButton: "#f4f4f5",
    iconButton: "#a1a1aa",
    body: "#f4f4f5",
    bodyMuted: "#a1a1aa",
    bodyDanger: "#ff794b",
  },
  radii: {
    small: "6px",
    medium: "8px",
    large: "12px",
    xlarge: "16px",
  },
  shadows: {
    primaryButton: "0px 4px 12px rgba(0, 0, 0, 0.4)",
    walletItemSelected: "0px 2px 6px rgba(0, 0, 0, 0.3)",
  },
  fontWeights: {
    normal: "400",
    medium: "500",
    bold: "600",
  },
  fontSizes: {
    small: "14px",
    medium: "16px",
    large: "18px",
    xlarge: "20px",
  },
  typography: {
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    fontStyle: "normal",
    lineHeight: "1.3",
    letterSpacing: "1",
  },
};

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
        <WalletProvider autoConnect theme={sweemDarkTheme}>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
