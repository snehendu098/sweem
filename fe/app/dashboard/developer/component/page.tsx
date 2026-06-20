"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PayModal } from "@/components/dashboard/sweem/request-payment-modal";

export default function TestComponentPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="dashboard-content flex min-h-[calc(100vh-60px)] flex-col items-center justify-center gap-4">
      <h1 className="text-[20px] font-semibold text-[var(--sw-text)]">Component preview</h1>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-[var(--sw-mint)] px-5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
      >
        Open payment
      </button>

      <PayModal
        open={open}
        onClose={() => setOpen(false)}
        amount={480}
        onPay={(data) => {
          toast.success("Payment", {
            description: `Pay ${data.total} ${data.token}`,
          });
          setOpen(false);
        }}
      />
    </div>
  );
}
