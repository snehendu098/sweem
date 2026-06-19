import { Reveal } from "@/components/motion/reveal";
import { InfiniteMovingCards, type MarqueeItem } from "@/components/ui/aceternity/infinite-moving-cards";

function Logo({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary">
      {children}
      <span className="whitespace-nowrap text-[15px] font-medium text-[#344054]">{label}</span>
    </div>
  );
}

const ecosystem: MarqueeItem[] = [
  {
    name: "Sui",
    node: (
      <Logo label="Sui">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
          <path d="M12 2C8 6.5 6 9.7 6 13a6 6 0 0 0 12 0c0-3.3-2-6.5-6-11zm0 16.5A4.5 4.5 0 0 1 7.5 14c0-1.2.4-2.5 1.3-4 .3 2 1.6 3.2 3.6 4 2.3.9 3 2.1 3 3.5A4.5 4.5 0 0 1 12 18.5z" />
        </svg>
      </Logo>
    ),
  },
  {
    name: "Navi",
    node: (
      <Logo label="Navi Protocol">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 15l2-6 4-2-2 6z" fill="currentColor" stroke="none" />
        </svg>
      </Logo>
    ),
  },
  {
    name: "Scallop",
    node: (
      <Logo label="Scallop">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M12 4c4.5 0 7 3.5 7 8H5c0-4.5 2.5-8 7-8z" />
          <path d="M9 12V8M12 12V7M15 12V8" strokeLinecap="round" />
        </svg>
      </Logo>
    ),
  },
  {
    name: "USDC",
    node: (
      <Logo label="USDC">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M9.8 9.4C9.8 8.3 10.8 7.6 12 7.6s2.2.7 2.2 1.8-1 1.6-2.2 1.6-2.2.7-2.2 1.8 1 1.8 2.2 1.8 2.2-.7 2.2-1.8" strokeLinecap="round" />
        </svg>
      </Logo>
    ),
  },
  {
    name: "Cetus",
    node: (
      <Logo label="Cetus">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M7 13c1.8-2.5 3.3-2.5 5 0s3.2 2.5 5 0" strokeLinecap="round" />
        </svg>
      </Logo>
    ),
  },
  {
    name: "Bucket",
    node: (
      <Logo label="Bucket">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M5 7h14l-1.5 12a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9z" />
          <path d="M4 7h16" strokeLinecap="round" />
        </svg>
      </Logo>
    ),
  },
];

export function IntegrationsSection() {
  return (
    <section className="border-y border-border bg-white py-12">
      <Reveal className="mx-auto w-full max-w-7xl px-6 md:px-12 lg:px-24">
        <p className="mb-8 text-center text-[13px] font-medium text-text-muted">
          Powered by the Sui ecosystem
        </p>
        <InfiniteMovingCards items={ecosystem} speed="slow" />
      </Reveal>
    </section>
  );
}
