"use client";

import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";

import { readStreamedAddresses } from "./tx";

// Shared across Org + Employees: the set of employee addresses that already have
// an on-chain Stream in the pool. Keyed by poolId so react-query dedupes the read
// when both components mount. Returns an empty set until a poolId is known.
export function useStreamedAddresses(poolId?: string) {
  const client = useSuiClient();
  const query = useQuery({
    queryKey: ["streamedAddrs", poolId],
    enabled: !!poolId,
    refetchInterval: 8000,
    queryFn: () => readStreamedAddresses(client, poolId!),
  });
  return {
    ...query,
    streamed: query.data ?? new Set<string>(),
  };
}
