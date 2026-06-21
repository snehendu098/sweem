"use client";

import { useSweemApi } from "@/lib/api";

// Only sends walletAddress, server fetches all org data from DB using this key.
export function useAgentContext() {
  const api = useSweemApi();
  return { walletAddress: api.address };
}
