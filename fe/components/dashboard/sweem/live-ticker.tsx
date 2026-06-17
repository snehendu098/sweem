"use client";

import { useEffect, useState } from "react";
import { formatNano } from "./helpers";

// Live-ticking USDC value rendered in exact bigint (nano-USDC, 9 dp). Anchored to
// the last on-chain poll and interpolated each animation frame at the stream rate
// — the low-order digits churn like a real ms counter. Re-anchors when `baseRaw`
// or `anchorAt` change. Used for both the org "streamed to date" and the employee
// "claimable now" displays. `raw` amounts are 6 dp → ×1000 = nano.
export function LiveTicker({
  baseRaw,
  rateRaw,
  periodMs,
  anchorAt,
  active,
}: {
  baseRaw: bigint;
  rateRaw: bigint;
  periodMs: bigint;
  anchorAt?: number;
  active: boolean;
}) {
  const [display, setDisplay] = useState(() => formatNano(baseRaw * 1000n));

  useEffect(() => {
    const anchor = anchorAt ?? Date.now();
    let raf = 0;
    const tick = () => {
      const elapsed = BigInt(Math.max(0, Date.now() - anchor));
      const accruedNano =
        active && periodMs > 0n ? (rateRaw * 1000n * elapsed) / periodMs : 0n;
      setDisplay(formatNano(baseRaw * 1000n + accruedNano));
      if (active) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [baseRaw, rateRaw, periodMs, anchorAt, active]);

  return <span className="sweem-mono">{display}</span>;
}
