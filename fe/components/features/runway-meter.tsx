"use client";

import { motion } from "framer-motion";
import { NumberTicker } from "@/components/ui/number-ticker";

// Treasury burns down to $0 over the runway — a designed area chart.
const LINE = "M4,18 C60,28 95,44 150,60 C200,74 240,88 286,96";
const AREA = `${LINE} L286,108 L4,108 Z`;
const GRID_Y = [24, 56, 88];

export function RunwayMeter() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2.5 bg-[#131316] p-5">
      <div className="flex items-end justify-between">
        <div className="flex items-end gap-1.5 text-white">
          <NumberTicker value={428} className="text-[42px] font-semibold leading-none" />
          <span className="pb-1 text-[14px] text-white/55">days</span>
        </div>
        <span className="rounded-full bg-[rgba(196,245,107,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#c4f56b]">
          projected runway
        </span>
      </div>

      {/* burn-down: treasury declining to $0 */}
      <div className="relative h-[112px] w-full">
        <span className="absolute left-0 top-0 z-10 text-[10px] tabular-nums text-white/40">$128.5k</span>
        <span className="absolute bottom-4 right-0 z-10 text-[10px] tabular-nums text-white/40">$0</span>

        <svg className="h-full w-full" viewBox="0 0 300 112" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="runwayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(196,245,107,0.32)" />
              <stop offset="100%" stopColor="rgba(196,245,107,0)" />
            </linearGradient>
          </defs>

          {/* dashed gridlines */}
          {GRID_Y.map((y) => (
            <line
              key={y}
              x1="0"
              x2="300"
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={1}
              strokeDasharray="3 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* baseline ($0) */}
          <line x1="0" x2="300" y1="108" y2="108" stroke="rgba(255,255,255,0.12)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

          <motion.path
            d={AREA}
            fill="url(#runwayFill)"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.35 }}
          />
          <motion.path
            d={LINE}
            fill="none"
            stroke="#c4f56b"
            strokeWidth={2.25}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: "drop-shadow(0 1px 5px rgba(196,245,107,0.5))" }}
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.3, ease: "easeOut" }}
          />
        </svg>

        {/* start marker (today) */}
        <span className="absolute z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#c4f56b] bg-[#131316]" style={{ left: "1.3%", top: "16px" }} />
        {/* end marker (runs dry) + dashed drop */}
        <span className="absolute z-10 h-[14px] w-px -translate-x-1/2 bg-[rgba(196,245,107,0.4)]" style={{ left: "95.3%", top: "86px" }} />
        <span className="absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c4f56b] shadow-[0_0_10px_#c4f56b]" style={{ left: "95.3%", top: "86px" }} />

        {/* x-axis labels */}
        <span className="absolute bottom-0 left-0 text-[10px] text-white/35">Now</span>
        <span className="absolute bottom-0 right-0 text-[10px] text-white/45">Runs dry</span>
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
