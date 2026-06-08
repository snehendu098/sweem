import { FeatureCard } from "@/components/features/feature-card";
import { Reveal } from "@/components/motion/reveal";

const rowOne = [
  {
    id: "global-payments",
    lead: "Manage global payments.",
    rest: "Effortlessly track, convert, and stay compliant in one dashboard.",
  },
  {
    id: "instant-transfers",
    lead: "Instant cross-border transfers.",
    rest: "Send funds to 180+ countries in seconds with live FX rates and zero hidden fees.",
  },
];

const rowTwo = [
  {
    id: "rewards",
    lead: "Get Gifts and Bonus.",
    rest: "Earn exclusive rewards, bonuses, and benefits with every eligible transaction.",
  },
  {
    id: "analytics",
    lead: "Real-time analytics.",
    rest: "Understand every dollar with clear charts, breakdowns, and exportable reports.",
  },
  {
    id: "security",
    lead: "Bank-grade security.",
    rest: "End-to-end encryption, 2FA, and SOC 2 compliance keep your funds protected.",
  },
];

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M13 2 L4 14 h6 l-1 8 9-12 h-6 z" />
    </svg>
  );
}

export function FeaturesSection() {
  return (
    <section id="features" className="bg-[#f9fafb] px-24 py-20 md:py-24">
      <div className="w-full">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
            <BoltIcon />
            Core Features
          </p>
          <h2 className="mt-3 whitespace-nowrap text-[33px] font-medium leading-[1.08] tracking-[-0.02em] text-[#101828] md:text-[42px]">
            Powerful Finance, Zero Complexity
          </h2>
          <p className="mt-4 whitespace-nowrap text-[14px] leading-6 text-[#667085]">
            Clear insights and tools to manage, track, and grow your finances with confidence.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {rowOne.map((card, index) => (
            <Reveal key={card.id} delay={index * 0.08}>
              <FeatureCard {...card} aspect="aspect-[3/2]" align="left" large />
            </Reveal>
          ))}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {rowTwo.map((card, index) => (
            <Reveal key={card.id} delay={index * 0.08}>
              <FeatureCard {...card} aspect="aspect-[16/15]" align="center" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
