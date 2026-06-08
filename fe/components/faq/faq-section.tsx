"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/reveal";

const faqs = [
  { q: "How do I update my account information?" },
  { q: "Can I change my email address?", a: "Yes. Simply go to account settings, enter your new email, and verify it securely." },
  { q: "What should I do if I forget my password?" },
  { q: "How long does it take to process payments?" },
  { q: "How can I contact customer support?" },
  { q: "What are the accepted payment methods?" },
  { q: "How do I update my account information?" },
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

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-10 text-[#c5cdd8]" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 15.5l-5-5L5 20.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FaqSection() {
  const [open, setOpen] = useState(1);

  return (
    <section id="faq" className="bg-white px-24 py-20">
      <div className="w-full">
        {/* header */}
        <Reveal className="mb-10 text-center">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
            <QuestionIcon />
            FAQ
          </p>
          <h2 className="mt-3 text-[33px] font-medium leading-[1.08] tracking-[-0.02em] text-[#101828] md:text-[42px]">
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-[14px] text-[#667085]">
            Everything you need to know, explained clearly and simply.
          </p>
        </Reveal>

        {/* body */}
        <div className="grid grid-cols-[300px_1fr] items-start gap-8">
          {/* left */}
          <Reveal>
            <div className="flex flex-col gap-4">
              {/* image placeholder */}
              <div className="flex h-[340px] w-full items-center justify-center overflow-hidden rounded-[16px] bg-[#eef4f8]">
                <ImageIcon />
              </div>
              {/* contact card */}
              <div className="rounded-[16px] bg-[#f7f8fa] p-5">
                <h3 className="text-[15px] font-semibold text-[#101828]">Do you have more questions?</h3>
                <p className="mt-1.5 text-[12px] leading-[1.7] text-[#667085]">
                  Our team will answer all your questions. We ensure a quick response.
                </p>
                <button className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#0a0e16] px-5 py-2.5 text-[12px] font-medium text-white">
                  Contact Us
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </Reveal>

          {/* right: FAQ list */}
          <Reveal delay={0.08}>
            <div className="space-y-2.5">
              {faqs.map((faq, index) => (
                <button
                  key={index}
                  onClick={() => setOpen(open === index ? -1 : index)}
                  className="w-full rounded-[14px] bg-[#f7f8fa] px-6 py-4 text-left"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-5">
                      <span className="shrink-0 text-[14px] font-medium text-[#98a2b3]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[16px] font-medium text-[#101828]">{faq.q}</span>
                    </div>
                    <span className="shrink-0 text-[20px] font-light leading-none text-[#667085]">
                      {open === index ? "−" : "+"}
                    </span>
                  </div>
                  {open === index && faq.a && (
                    <p className="mt-2 pl-[42px] text-[12px] leading-[1.7] text-[#667085]">{faq.a}</p>
                  )}
                </button>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
