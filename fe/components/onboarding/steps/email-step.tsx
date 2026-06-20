"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, ShieldCheck } from "lucide-react";
import type { SweemApi } from "../onboarding-wizard";
import { Card, Field, GhostButton, PrimaryButton, onbInputCls } from "../ui";
import { cn } from "@/lib/utils";

type Phase = "enter" | "verify";

export function EmailStep({
  api,
  wallet,
  onNext,
}: {
  api: SweemApi;
  wallet: string;
  onNext: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("enter");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Enter a valid email");
      return;
    }
    setBusy(true);
    try {
      const res = await api.startEmailVerification(wallet, email.trim());
      if (res.devMode && res.code) {
        setDevCode(res.code);
        setCode(res.code);
        toast.message("Dev mode", { description: `Your code is ${res.code}` });
      } else if (res.sent) {
        toast.success("Code sent — check your inbox");
      } else {
        toast.warning("Couldn't send the email, but you can retry");
      }
      setPhase("verify");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      await api.confirmEmail(wallet, code);
      await api.orgQuery.refetch();
      toast.success("Email verified");
      onNext();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "enter") {
    return (
      <Card
        title="Connect your email"
        subtitle="Get payroll alerts and runway warnings. We'll send a 6-digit code to verify it."
        footer={
          <>
            <span className="text-[12px] text-[var(--sw-text-dim)]">Step 3 of 4 · optional</span>
            <div className="flex items-center gap-2">
              <GhostButton onClick={onNext}>Skip</GhostButton>
              <PrimaryButton onClick={sendCode} loading={busy}>
                <Mail className="size-4" strokeWidth={2.2} /> Send code
              </PrimaryButton>
            </div>
          </>
        }
      >
        <Field label="Organization email">
          <input
            className={onbInputCls}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="founder@acme.com"
            onKeyDown={(e) => e.key === "Enter" && sendCode()}
            autoFocus
          />
        </Field>
      </Card>
    );
  }

  return (
    <Card
      title="Enter your code"
      subtitle={
        <>
          We sent a 6-digit code to <span className="text-[var(--sw-text)]">{email}</span>.
          {devCode && (
            <span className="mt-1 block text-[12px] text-[var(--sw-mint)]">
              Dev mode — code is {devCode}
            </span>
          )}
        </>
      }
      footer={
        <>
          <GhostButton onClick={() => setPhase("enter")}>Change email</GhostButton>
          <PrimaryButton onClick={confirm} loading={busy}>
            <ShieldCheck className="size-4" strokeWidth={2.2} /> Verify
          </PrimaryButton>
        </>
      }
    >
      <input
        className={cn(onbInputCls, "text-center text-[22px] font-semibold tracking-[0.4em]")}
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        onKeyDown={(e) => e.key === "Enter" && confirm()}
        autoFocus
      />
      <button
        type="button"
        onClick={sendCode}
        disabled={busy}
        className="mt-3 text-[12px] text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] disabled:opacity-50"
      >
        Resend code
      </button>
    </Card>
  );
}
