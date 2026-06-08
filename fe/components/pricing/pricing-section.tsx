"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/reveal";
import { PricingCard } from "@/components/pricing/pricing-card";

function DollarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5C9.5 8.1 10.6 7 12 7s2.5 1.1 2.5 2.5S13.4 12 12 12s-2.5 1.1-2.5 2.5S10.6 17 12 17s2.5-1.1 2.5-2.5" strokeLinecap="round" />
    </svg>
  );
}

const plans = [
  {
    name: "Starter Plan",
    subtitle: "For Freelancers & Small Teams",
    price: "$0",
    cta: "Current Plan",
    features: [
      "Unlimited invoices & clients",
      "Real-time income & expense tracking",
      "Automated tax-ready reports",
      "Secure cloud storage",
      "Email support",
    ],
  },
  {
    name: "Professional Plan",
    subtitle: "For Growing Businesses",
    price: "$259.00",
    cta: "Upgrade to Pro",
    featured: true,
    features: [
      "Everything in Starter",
      "Advanced financial analytics",
      "Cash flow forecasting",
      "Multi-user access",
      "Priority support",
    ],
  },
  {
    name: "Enterprise Plan",
    subtitle: "For Large Organizations",
    price: "$800.00",
    cta: "Upgrade to Premium",
    features: [
      "Everything in Professional",
      "Custom financial dashboards",
      "Dedicated account manager",
      "API & system integrations",
      "Enterprise-grade security",
    ],
  },
];

function Toggle({ yearly, onToggle }: { yearly: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-3 text-[13px] font-medium text-[#344054]">
        <span className={!yearly ? "text-[#101828]" : "text-[#98a2b3]"}>Monthly</span>
        <button
          onClick={onToggle}
          className={`relative h-7 w-12 rounded-full transition-colors ${yearly ? "bg-[#1c6fd0]" : "bg-[#d0d5dd]"}`}
          aria-label="Toggle billing period"
        >
          <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-all ${yearly ? "left-[22px]" : "left-0.5"}`} />
        </button>
        <span className={yearly ? "text-[#101828]" : "text-[#98a2b3]"}>Yearly</span>
      </div>
      <span className="text-[11px] font-medium text-[#667085]">&#123; GET 65% OFF &#125;</span>
    </div>
  );
}

export function PricingSection() {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="bg-white px-24 py-20">
      <div className="w-full">
        <Reveal className="mb-10 text-center">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
            <DollarIcon />
            Pricing Plans
          </p>
          <h2 className="mt-3 text-[33px] font-medium leading-[1.08] tracking-[-0.02em] text-[#101828] md:text-[42px]">
            Our pricing is simple with no hidden fees
          </h2>
          <p className="mt-4 whitespace-nowrap text-[14px] leading-6 text-[#667085]">
            Our pricing is transparent and straightforward, so you always know exactly what you&apos;re paying for.
          </p>
          <div className="mt-7">
            <Toggle yearly={yearly} onToggle={() => setYearly(!yearly)} />
          </div>
        </Reveal>

        <div className="grid items-stretch gap-5 md:grid-cols-3">
          {plans.map((plan, index) => (
            <Reveal key={plan.name} delay={index * 0.06}>
              <PricingCard {...plan} />
            </Reveal>
          ))}
        </div>

        <Reveal className="relative mt-8 overflow-hidden rounded-[20px] bg-[#f7f8fa] px-8 py-7">
          <div className="absolute -bottom-6 -right-6 size-28 rounded-full bg-[#e8f0fb] opacity-60" />
          <div className="absolute -bottom-2 right-16 size-16 rounded-full bg-[#dbeafe] opacity-50" />
          <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h3 className="text-[18px] font-semibold text-[#101828]">Need a custom financial solution?</h3>
              <p className="mt-1 text-[13px] text-[#667085]">We tailor plans to match your business complexity and scale.</p>
            </div>
            <button className="shrink-0 rounded-full bg-[#0a0e16] px-7 py-3 text-[13px] font-medium text-white">
              Contact Us
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
