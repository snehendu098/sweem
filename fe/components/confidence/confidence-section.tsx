import { Reveal } from "@/components/motion/reveal";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-12 text-[#c5cdd8]" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 15.5l-5-5L5 20.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConfidenceSection() {
  return (
    <section className="bg-white px-24 py-20 md:py-24">
      <div className="w-full">
        {/* header row */}
        <Reveal className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
              <LockIcon />
              Seamless Control
            </p>
            <h2 className="mt-3 text-[33px] font-medium leading-[1.1] tracking-[-0.02em] text-[#101828] md:text-[42px]">
              Manage Every Payment<br />with Confidence
            </h2>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end md:pt-8 md:text-right">
            <p className="max-w-[310px] text-[13px] leading-6 tracking-[-0.02em] text-[#667085]">
              From bills to transfers, schedule, track, and automate your finances effortlessly in one place.
            </p>
            <button className="rounded-full bg-[#0a0e16] px-6 py-2.5 text-[13px] font-normal text-white shadow-[0_8px_22px_rgba(10,14,22,0.18)]">
              Start Free trial
            </button>
          </div>
        </Reveal>

        {/* banner — full image placeholder */}
        <Reveal>
          <div className="grid min-h-[450px] w-full place-items-center overflow-hidden rounded-[24px] bg-[#eef4f8]">
            <ImageIcon />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
