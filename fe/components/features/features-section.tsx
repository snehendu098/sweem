import { FeatureCard } from "@/components/features/feature-card";
import { IdleYieldMap } from "@/components/features/idle-yield-map";
import { YieldRouting } from "@/components/confidence/yield-routing";
import { RunwayMeter } from "@/components/features/runway-meter";
import { StreamControl } from "@/components/features/stream-control";
import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";

const rowOne = [
  {
    id: "global-payments",
    tag: "Streaming",
    lead: "Pay by the second",
    rest: "Your team accrues salary continuously onchain — no payday.",
    image: "/assets/1.png",
    imageAlt: "Salaries streaming to a team onchain",
  },
  {
    id: "instant-transfers",
    tag: "Yield",
    lead: "Idle cash never sleeps",
    rest: "Unclaimed payroll auto-invests on Sui and keeps earning.",
    image: "/assets/2.png",
    imageAlt: "Idle payroll funds earning yield across Sui protocols",
  },
];

const rowTwo = [
  {
    id: "rewards",
    tag: "Visibility",
    lead: "Know your runway",
    rest: "See how long your treasury funds payroll, live.",
    image: "/assets/3.png",
    imageAlt: "Live payroll runway visibility",
  },
  {
    id: "analytics",
    tag: "Control",
    lead: "Total stream control",
    rest: "Pause, resume, or stop any stream instantly.",
    image: "/assets/4.png",
    imageAlt: "Pause, resume, and stop individual salary streams",
  },
  {
    id: "security",
    tag: "Security",
    lead: "Your keys, your payroll",
    rest: "Wallet-signed and non-custodial, settled on Sui.",
    image: "/assets/5.png",
    imageAlt: "Non-custodial payroll secured by wallet signatures",
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
    <Section id="features" className="bg-[#f9fafb]">
      <SectionHeading
        align="center"
        eyebrow="Core Features"
        eyebrowIcon={<BoltIcon />}
        title="Onchain payroll, zero overhead"
        description="Everything you need to run payroll that streams, earns, and stays under your control — all settled on Sui."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {rowOne.map((card, index) => (
          <Reveal key={card.id} delay={index * 0.08}>
            <FeatureCard
              {...card}
              aspect="aspect-[3/2]"
              align="left"
              large
              media={
                card.id === "instant-transfers" ? (
                  <IdleYieldMap />
                ) : card.id === "global-payments" ? (
                  <YieldRouting />
                ) : undefined
              }
            />
          </Reveal>
        ))}
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rowTwo.map((card, index) => (
          <Reveal key={card.id} delay={index * 0.08}>
            <FeatureCard
              {...card}
              aspect="aspect-[16/15]"
              align="center"
              media={
                card.id === "rewards" ? (
                  <RunwayMeter />
                ) : card.id === "analytics" ? (
                  <StreamControl />
                ) : undefined
              }
              frameClassName={card.id === "security" ? "bg-[#0a0c10]" : undefined}
            />
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
