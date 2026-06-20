"use client";

import { createRef, forwardRef, useRef } from "react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { cn } from "@/lib/utils";

const LIME = "#c4f56b";
const VIOLET = "#bcaef7";

// Distributed team — each gets streamed salary from the pool.
const EMPLOYEES = [
  { name: "Alex", color: LIME },
  { name: "Mia", color: VIOLET },
  { name: "Sam", color: LIME },
];

const Node = forwardRef<
  HTMLDivElement,
  { className?: string; children: React.ReactNode; size?: "md" | "lg" }
>(({ className, children, size = "md" }, ref) => (
  <div
    ref={ref}
    className={cn(
      "z-10 flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] backdrop-blur-md",
      "shadow-[0_4px_20px_rgba(0,0,0,0.35)]",
      size === "lg" ? "size-16" : "size-11",
      className,
    )}
  >
    {children}
  </div>
));
Node.displayName = "Node";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-[11px] font-medium text-white/55">{label}</span>
    </div>
  );
}

function UserIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke={color} strokeWidth="1.9" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
    </svg>
  );
}

export function YieldRouting() {
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  const naviRef = useRef<HTMLDivElement>(null);
  const scallopRef = useRef<HTMLDivElement>(null);
  const empRefs = useRef(EMPLOYEES.map(() => createRef<HTMLDivElement>()));

  const mid = (EMPLOYEES.length - 1) / 2;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-stretch justify-between overflow-hidden bg-[#0a0c10] px-6 md:px-12"
    >
      {/* left — team (salary streamed to each) */}
      <div className="z-10 flex flex-col justify-center gap-6">
        {EMPLOYEES.map((e, i) => (
          <Labeled key={i} label={e.name}>
            <Node ref={empRefs.current[i]}>
              <UserIcon color={e.color} />
            </Node>
          </Labeled>
        ))}
      </div>

      {/* center — payroll pool */}
      <div className="z-10 flex flex-col justify-center">
        <Labeled label="Payroll pool">
          <Node ref={poolRef} size="lg">
            <img src="/protocols/lending/usd-coin-usdc-logo.png" alt="USDC" className="size-9" />
          </Node>
        </Labeled>
      </div>

      {/* right — yield protocols (idle cash routed in) */}
      <div className="z-10 flex flex-col justify-center gap-12">
        <Labeled label="Navi · 6.4%">
          <Node ref={naviRef}>
            <img src="/protocols/lending/navi.webp" alt="Navi" className="size-9 rounded-full" />
          </Node>
        </Labeled>
        <Labeled label="Scallop · 5.8%">
          <Node ref={scallopRef}>
            <img src="/protocols/lending/scallop.png" alt="Scallop" className="size-9 rounded-full" />
          </Node>
        </Labeled>
      </div>

      {/* salary streams: employees → pool (unidirectional, left → right) */}
      {EMPLOYEES.map((_, i) => (
        <AnimatedBeam
          key={i}
          containerRef={containerRef}
          fromRef={empRefs.current[i]}
          toRef={poolRef}
          curvature={(mid - i) * 12}
          duration={4}
          delay={i * 0.25}
          pathColor="#ffffff"
          pathOpacity={0.08}
          gradientStartColor={LIME}
          gradientStopColor={VIOLET}
        />
      ))}

      {/* idle cash routed: pool → yield protocols (left → right) */}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={poolRef}
        toRef={naviRef}
        curvature={20}
        duration={4}
        delay={0.4}
        pathColor="#ffffff"
        pathOpacity={0.08}
        gradientStartColor={LIME}
        gradientStopColor={VIOLET}
      />
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={poolRef}
        toRef={scallopRef}
        curvature={-20}
        duration={4}
        delay={0.9}
        pathColor="#ffffff"
        pathOpacity={0.08}
        gradientStartColor={LIME}
        gradientStopColor={VIOLET}
      />
    </div>
  );
}
