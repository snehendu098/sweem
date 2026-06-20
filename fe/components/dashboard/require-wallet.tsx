"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAutoConnectWallet, useCurrentAccount } from "@mysten/dapp-kit";
import { Loader2 } from "lucide-react";

// Gate for app routes (dashboard / onboarding). A disconnected visitor is sent
// to the landing page `/` (where the wallet is connected). We wait until
// autoConnect has settled before deciding, so returning users aren't bounced
// during the silent reconnect.
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const account = useCurrentAccount();
  const autoConnect = useAutoConnectWallet();
  const router = useRouter();
  const settled = autoConnect === "attempted" || autoConnect === "disabled";

  useEffect(() => {
    if (settled && !account) router.replace("/");
  }, [settled, account, router]);

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <Loader2 className="size-5 animate-spin text-white/50" />
      </div>
    );
  }

  return <>{children}</>;
}
