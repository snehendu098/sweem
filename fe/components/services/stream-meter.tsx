"use client";

import { useEffect, useState } from "react";

const RATE = 0.0188; // USD per ms (visual only)
const BARS = [0.4, 0.7, 0.5, 0.9, 0.6, 1, 0.55, 0.8, 0.45, 0.95, 0.65, 0.85];

/**
 * Live "salary streaming" visual for the Core Service feature tile: a counter
 * that accrues every animation frame above an equalizer of pulsing bars.
 * Both halves stop under prefers-reduced-motion (frame loop guarded here,
 * bars via the .stream-bar media query in globals.css).
 */
export function StreamMeter() {
  const [total, setTotal] = useState(128540.42);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setTotal((v) => v + dt * RATE);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [whole, cents] = total
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split(".");

  return (
    <div className="rounded-2xl border border-border bg-white/70 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          Streaming now
        </span>
        <span className="text-[11px] font-medium text-text-muted">+${(RATE * 1000).toFixed(2)}/s</span>
      </div>

      <div className="mt-3 font-semibold tracking-tight text-text-primary tabular-nums">
        <span className="text-[34px] leading-none">${whole}</span>
        <span className="text-[18px] text-text-muted">.{cents}</span>
      </div>

      {/* equalizer */}
      <div className="mt-4 flex h-10 items-end gap-1.5">
        {BARS.map((h, i) => (
          <span
            key={i}
            className="stream-bar w-full rounded-full bg-gradient-to-t from-brand/40 to-brand"
            style={{ height: `${h * 100}%`, animationDelay: `${i * 0.11}s` }}
          />
        ))}
      </div>
    </div>
  );
}
