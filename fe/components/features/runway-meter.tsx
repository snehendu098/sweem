"use client";

import { motion } from "framer-motion";
import { NumberTicker } from "@/components/ui/number-ticker";

export function RunwayMeter() {
  return (
    <div className="absolute inset-0 flex flex-col items-start justify-center gap-3 bg-[#0a0c10] p-5">
      <div className="flex items-end gap-1.5 text-white">
        <NumberTicker value={428} className="text-[42px] font-semibold leading-none" />
        <span className="pb-1 text-[14px] text-white/55">days</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-[#c4f56b] to-[#bcaef7]"
          initial={{ width: 0 }}
          whileInView={{ width: "72%" }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
        />
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-white/45">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#c4f56b] opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-[#c4f56b]" />
        </span>
        $128,540 treasury · $7,460 / mo committed
      </p>
    </div>
  );
}
