import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";
import { Button } from "@/components/ui/button";
import { StreamMeter } from "@/components/services/stream-meter";
import { cn } from "@/lib/utils";

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2a10 10 0 1 0 10 10" strokeLinecap="round" />
      <path d="M22 2l-4 4M22 2h-5M22 2v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "group flex flex-col rounded-[22px] border border-border bg-surface p-6 transition duration-300",
        "hover:-translate-y-1 hover:border-brand/30 hover:shadow-[0_18px_40px_rgba(4,40,80,0.08)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TileCopy({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mt-5">
      <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-text-secondary">{desc}</p>
    </div>
  );
}

const yields = [
  { name: "Navi", apy: "6.4%", logo: "/protocols/lending/navi.webp" },
  { name: "Scallop", apy: "5.8%", logo: "/protocols/lending/scallop.png" },
];

const allocation: { label: string; pct: number; color: string; logo?: string }[] = [
  { label: "Wallet", pct: 40, color: "#0a0e16" },
  { label: "Navi", pct: 35, color: "#1c6fd0", logo: "/protocols/lending/navi.webp" },
  { label: "Scallop", pct: 25, color: "#7cc0f2", logo: "/protocols/lending/scallop.png" },
];

function TrendUp() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M4 16l5-5 4 4 7-7M16 8h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ServicesSection() {
  return (
    <Section className="bg-white">
      <SectionHeading
        eyebrow="Core Service"
        eyebrowIcon={<ServiceIcon />}
        title={
          <>
            Run payroll that <span className="text-text-muted">streams in real time</span>
          </>
        }
        description="Fund a pool once and pay your whole team by the second on Sui — idle balances earn yield until salaries are claimed."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* A — feature: real-time streaming (wide) */}
        <Reveal className="md:col-span-2">
          <Tile className="h-full rounded-[28px] bg-surface p-7">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-brand">
              Core engine
            </span>
            <div className="mt-5">
              <StreamMeter />
            </div>
            <TileCopy
              title="Real-Time Streaming"
              desc="Salaries accrue every millisecond onchain — no payday, no batch runs. Fund the pool once and the team gets paid continuously."
            />
          </Tile>
        </Reveal>

        {/* B — yield on idle cash */}
        <Reveal delay={0.06}>
          <Tile className="h-full justify-between">
            <div className="flex flex-col gap-2">
              {yields.map((y) => (
                <div
                  key={y.name}
                  className="flex items-center justify-between rounded-xl border border-border bg-white px-3 py-2.5"
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                    <img src={y.logo} alt={y.name} className="size-5 rounded-full object-contain" />
                    {y.name}
                  </span>
                  <span className="flex items-center gap-1 text-[13px] font-semibold text-brand">
                    <TrendUp />
                    {y.apy} APY
                  </span>
                </div>
              ))}
            </div>
            <TileCopy
              title="Yield on Idle Cash"
              desc="Unclaimed payroll auto-invests across Navi & Scallop and keeps earning until claimed."
            />
          </Tile>
        </Reveal>

        {/* C — claim anytime */}
        <Reveal delay={0.12}>
          <Tile className="h-full justify-between">
            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Claimable</p>
              <p className="mt-1 text-[24px] font-semibold tabular-nums text-text-primary">$1,240.18</p>
              <Button className="mt-3 h-9 w-full rounded-full bg-brand text-white hover:bg-brand/90">
                Claim now
              </Button>
            </div>
            <TileCopy
              title="Claim Anytime"
              desc="Employees withdraw earned salary 24/7 — straight to wallet or a vault."
            />
          </Tile>
        </Reveal>

        {/* D — employee vaults (wide) */}
        <Reveal delay={0.06} className="md:col-span-2">
          <Tile className="h-full justify-between">
            <div className="rounded-2xl border border-border bg-white p-4">
              <div className="flex h-3 overflow-hidden rounded-full">
                {allocation.map((a) => (
                  <div key={a.label} style={{ width: `${a.pct}%`, background: a.color }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {allocation.map((a) => (
                  <span key={a.label} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                    {a.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.logo} alt={a.label} className="size-4 rounded-full object-contain" />
                    ) : (
                      <span className="size-2 rounded-full" style={{ background: a.color }} />
                    )}
                    {a.label}
                    <span className="font-semibold text-text-primary">{a.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
            <TileCopy
              title="Employee Vaults"
              desc="Route claimed pay across your wallet and custom yield strategies — your allocation, your call."
            />
          </Tile>
        </Reveal>
      </div>
    </Section>
  );
}
