import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";
import { ImagePlaceholder } from "@/components/ui/image-placeholder";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    q: "How does salary streaming work?",
    a: "You fund a token pool once and set each employee's rate. Their salary then accrues every millisecond onchain, and they can claim the earned amount whenever they want.",
  },
  {
    q: "What happens to unclaimed payroll?",
    a: "Idle funds are automatically invested into Sui lending protocols like Navi and Scallop, earning yield until an employee claims their salary.",
  },
  {
    q: "Which blockchain does Sweem use?",
    a: "Sweem runs entirely on Sui. Pools, streams, and vaults are Move objects, so balances and payouts settle trustlessly onchain.",
  },
  {
    q: "Can employees claim their salary anytime?",
    a: "Yes — earned salary is claimable 24/7, there's no payday. Employees withdraw to their wallet or route it into a yield vault.",
  },
  {
    q: "How do I pause or stop a stream?",
    a: "From the dashboard you can pause, resume, or stop any individual stream. Paused time is excluded from accrual; stopping returns the remaining funds to your pool.",
  },
  {
    q: "Which tokens and yield protocols are supported?",
    a: "Sweem supports multi-token pools and routes idle funds to Sui protocols including Navi and Scallop. New protocols are added through the registry — no contract upgrades needed.",
  },
  {
    q: "Is Sweem custodial?",
    a: "No. Funds live in onchain pools and vaults you control via wallet signatures. Sweem never takes custody of your payroll.",
  },
];

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2.5-2.5 3.5" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function FaqSection() {
  return (
    <Section id="faq" className="bg-white">
      <SectionHeading
        align="center"
        eyebrow="FAQ"
        eyebrowIcon={<QuestionIcon />}
        title="Frequently Asked Questions"
        description="Everything you need to know about streaming payroll on Sweem."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[320px_1fr]">
        {/* left */}
        <Reveal>
          <div className="flex flex-col gap-4">
            <div className="grid h-[300px] w-full place-items-center overflow-hidden rounded-[16px] border border-border bg-surface">
              <ImagePlaceholder iconSize="size-10" />
            </div>
            <div className="rounded-[16px] border border-border bg-surface p-5">
              <h3 className="text-[15px] font-semibold text-text-primary">Do you have more questions?</h3>
              <p className="mt-1.5 text-[12px] leading-[1.7] text-text-secondary">
                Our team will answer all your questions. We ensure a quick response.
              </p>
              <Button
                asChild
                size="sm"
                className="mt-4 gap-1.5 rounded-full bg-brand-dark text-white hover:bg-brand-dark/90"
              >
                <a href="#contact">
                  Contact Us
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </Button>
            </div>
          </div>
        </Reveal>

        {/* right: accordion */}
        <Reveal delay={0.08}>
          <Accordion type="single" collapsible defaultValue="faq-0" className="space-y-2.5">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={faq.q}
                value={`faq-${index}`}
                className="rounded-[14px] border border-border bg-surface px-6 last:border-b"
              >
                <AccordionTrigger className="gap-4 py-4 text-[16px] font-medium text-text-primary hover:no-underline">
                  <span className="flex items-center gap-5">
                    <span className="shrink-0 text-[14px] font-medium text-text-muted">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {faq.q}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pl-[42px] text-[13px] leading-[1.7] text-text-secondary">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}
