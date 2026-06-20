"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSweemApi } from "@/lib/api";
import { Stepper, type StepKey } from "./stepper";
import { ConnectStep } from "./steps/connect-step";
import { ImportStep } from "./steps/import-step";
import { EmailStep } from "./steps/email-step";
import { DoneStep } from "./steps/done-step";

export type SweemApi = ReturnType<typeof useSweemApi>;

export function OnboardingWizard() {
  const api = useSweemApi();
  const router = useRouter();
  const wallet = api.address;
  const org = api.orgQuery.data;
  const [step, setStep] = useState<StepKey>("connect");

  // Resuming: if the org already exists, skip the create step.
  useEffect(() => {
    if (org && step === "connect") setStep("import");
  }, [org, step]);

  const finish = () => router.push("/dashboard");

  return (
    <div>
      <Stepper current={step} />
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {step === "connect" && (
            <ConnectStep api={api} wallet={wallet} onNext={() => setStep("import")} />
          )}
          {step === "import" && wallet && (
            <ImportStep api={api} wallet={wallet} onNext={() => setStep("email")} />
          )}
          {step === "email" && wallet && (
            <EmailStep api={api} wallet={wallet} onNext={() => setStep("done")} />
          )}
          {step === "done" && <DoneStep onFinish={finish} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
