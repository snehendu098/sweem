import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { ImpactChart } from "@/components/stats/impact-chart";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const stats = [
  { value: "100%", label: "Onchain Settlement" },
  { value: "24/7", label: "Claimable Salary" },
  { value: "2+", label: "Integrated Yield Protocols" },
];

export function StatsSection() {
  return (
    <Section className="overflow-hidden bg-white">
      <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-16">
        {/* left — live growth visual */}
        <Reveal className="w-full lg:w-[380px] lg:shrink-0">
          <ImpactChart />
        </Reveal>

        {/* right */}
        <Reveal delay={0.08} className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand">
            <CheckIcon />
            Impacts
          </p>
          <h2 className="mt-3 text-[clamp(28px,4vw,42px)] font-medium leading-[1.12] tracking-[-0.02em]">
            <span className="text-text-primary">Pay your team in real time with full onchain </span>
            <span className="text-text-muted">visibility into every salary stream.</span>
          </h2>
          <p className="mt-5 max-w-[520px] text-[13px] leading-6 text-text-secondary">
            Move beyond monthly batch runs. Sweem settles payroll on Sui so every salary is
            streamed, claimable, and earning yield while it sits idle.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-8">
            {stats.map(({ value, label }) => (
              <div key={value} className="group">
                <span className="block h-[3px] w-7 rounded-full bg-brand/25 transition-[width,background-color] duration-300 group-hover:w-12 group-hover:bg-brand" />
                <dd className="mt-3 text-[clamp(28px,4vw,42px)] font-semibold leading-none tracking-[-0.02em] text-text-primary tabular-nums">
                  {value}
                </dd>
                <dt className="mt-1.5 text-[14px] text-text-secondary">{label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </Section>
  );
}
