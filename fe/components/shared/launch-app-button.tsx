"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConnectModal, useCurrentAccount } from "@mysten/dapp-kit";

// Wallet-aware "Launch app" CTA for the landing page. If a wallet is connected,
// it goes straight to /dashboard (which itself routes unregistered orgs on to
// /onboarding). Otherwise it opens the connect modal and routes once connected.
export function LaunchAppButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const account = useCurrentAccount();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // Once the user connects (after clicking launch), route into the app.
  useEffect(() => {
    if (pending && account) {
      setPending(false);
      router.push("/dashboard");
    }
  }, [pending, account, router]);

  if (account) {
    return (
      <button type="button" className={className} onClick={() => router.push("/dashboard")}>
        {children}
      </button>
    );
  }

  return (
    <ConnectModal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && !account) setPending(false);
      }}
      trigger={
        <button type="button" className={className} onClick={() => setPending(true)}>
          {children}
        </button>
      }
    />
  );
}
