import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { LaunchAppButton } from "@/components/shared/launch-app-button";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

export function ConfidenceSection() {
  return (
    <Section className="bg-white">
      <SectionHeading
        eyebrow="Seamless Control"
        eyebrowIcon={<LockIcon />}
        title={
          <>
            Run Every Payroll
            <br />
            with Confidence
          </>
        }
        description="Deposit once, stream to your team, and route idle cash to yield — automated and onchain."
        actions={
          <LaunchAppButton className="inline-flex h-10 items-center rounded-full bg-brand-dark px-6 text-[13px] font-medium text-white transition-colors hover:bg-brand-dark/90">
            Launch Dashboard
          </LaunchAppButton>
        }
      />

      <Reveal>
        <div className="grid h-[360px] w-full place-items-center overflow-hidden rounded-[24px] border border-border bg-surface md:h-[460px]">
          <ImagePlaceholder iconSize="size-12" />
        </div>
      </Reveal>
    </Section>
  );
}
