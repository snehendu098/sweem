"use client";

import { useState } from "react";
import { ConnectModal } from "@mysten/dapp-kit";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import type { SweemApi } from "../onboarding-wizard";
import { Card, Field, PrimaryButton, onbInputCls } from "../ui";

export function ConnectStep({
  api,
  wallet,
  onNext,
}: {
  api: SweemApi;
  wallet: string | undefined;
  onNext: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Enter your organization name");
      return;
    }
    setBusy(true);
    try {
      await api.ensureOrg(name.trim());
      await api.orgQuery.refetch();
      toast.success("Organization created");
      onNext();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <Card
        title="Connect your wallet"
        subtitle="Your organization is identified by your Sui wallet. Connect to begin onboarding."
      >
        <ConnectModal
          trigger={
            <button className="inline-flex items-center gap-2 rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90">
              <Wallet className="size-4" strokeWidth={2.2} /> Connect wallet
            </button>
          }
          open={modalOpen}
          onOpenChange={setModalOpen}
        />
      </Card>
    );
  }

  return (
    <Card
      title="Create your organization"
      subtitle="Name your org to start streaming payroll on Sui. You can add a logo later."
      footer={
        <>
          <span className="text-[12px] text-[var(--sw-text-dim)]">Step 1 of 4</span>
          <PrimaryButton onClick={handleCreate} loading={busy}>
            Create &amp; continue
          </PrimaryButton>
        </>
      }
    >
      <Field label="Organization name">
        <input
          className={onbInputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          autoFocus
        />
      </Field>
      <button
        type="button"
        onClick={() => setName("Sweem Demo Co")}
        className="mt-2.5 text-[12px] font-medium text-[var(--sw-mint)] transition-opacity hover:opacity-80"
      >
        Just exploring? Use a demo organization
      </button>
    </Card>
  );
}
