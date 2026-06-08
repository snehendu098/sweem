import { Reveal } from "@/components/motion/reveal";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
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

const stats = [
  { value: "4.9",   label: "Customer Rating" },
  { value: "$25M",  label: "Revenue Managed" },
  { value: "1600+", label: "Trusted Businesses" },
];

const logos = [
  {
    name: "Square",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      </svg>
    ),
  },
  {
    name: "Adobe",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M13.5 3 L22 21 H15.5 L13.5 16.5 H8.5 L13.5 3Z M10.5 3 L2 21 H8.5 L10.8 15.5" />
      </svg>
    ),
  },
  {
    name: "reddit",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#ff4500" />
        <path fill="white" d="M17.5 12a1.5 1.5 0 0 0-2.5-1.1c-1-.6-2.3-1-3.7-1l.6-2.9 2 .4a1 1 0 1 0 .1-.5l-2.3-.5-.8 3.5c-1.4.1-2.7.5-3.7 1.1A1.5 1.5 0 1 0 9 13.4a4 4 0 0 0-.1.6c0 2 2.2 3.5 5 3.5s5-1.6 5-3.5a4 4 0 0 0-.1-.6 1.5 1.5 0 0 0 .7-1.4zm-9 1a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm5.5 2.5c-.6.6-1.6.9-2 .9s-1.4-.3-2-.9a.3.3 0 0 1 .4-.4c.5.5 1.2.7 1.6.7s1.1-.2 1.6-.7a.3.3 0 0 1 .4.4zm-.2-1.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
      </svg>
    ),
  },
  {
    name: "Medium",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <circle cx="7" cy="12" r="4" />
        <ellipse cx="16" cy="12" rx="2" ry="4" />
        <ellipse cx="21.5" cy="12" rx="1" ry="3.5" />
      </svg>
    ),
  },
  {
    name: "Trello",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <rect x="2" y="2" width="20" height="20" rx="3" fill="#0052cc" />
        <rect x="5" y="5" width="5" height="11" rx="1" fill="white" />
        <rect x="13" y="5" width="5" height="7" rx="1" fill="white" />
      </svg>
    ),
  },
  {
    name: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.54 2.87 8.39 6.84 9.75.5.09.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.1-1.5-1.1-1.5-.9-.63.07-.62.07-.62 1 .07 1.52 1.05 1.52 1.05.88 1.55 2.32 1.1 2.88.84.09-.65.35-1.1.63-1.35-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 2.5-.34c.85 0 1.7.11 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.59.69.49A10.27 10.27 0 0 0 22 12.26C22 6.58 17.52 2 12 2z" />
      </svg>
    ),
  },
];

export function StatsSection() {
  return (
    <section className="overflow-hidden bg-white px-24 py-20 md:py-24">
      <div className="w-full">
        {/* main row */}
        <div className="flex w-full items-start gap-14">
          {/* left */}
          <Reveal className="w-[320px] shrink-0">
            <p className="mb-5 text-[22px] font-normal text-[#101828]">Results</p>
            <div className="grid w-full place-items-center overflow-hidden rounded-[20px] bg-[#f3f4f6]" style={{ aspectRatio: "4/3.6" }}>
              <ImageIcon />
            </div>
          </Reveal>

          {/* right */}
          <Reveal delay={0.08} className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
              <CheckIcon />
              Impacts
            </p>
            <h2 className="mt-3 text-[33px] font-medium leading-[1.12] tracking-[-0.02em] md:text-[42px]">
              <span className="text-[#101828]">Make smarter financial decisions<br />with real-time </span>
              <span className="text-[#9aa5b4]">insights and full<br />visibility into your growth.</span>
            </h2>
            <p className="mt-5 max-w-[520px] text-[13px] leading-6 text-[#667085]">
              Move beyond spreadsheets and manual tracking. Our platform centralizes your financial data so every decision is backed by clarity, accuracy, and confidence.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-[#eaecf0] pt-8">
              {stats.map(({ value, label }) => (
                <div key={value}>
                  <div className="text-[42px] font-semibold tracking-[-0.02em] text-[#101828]">{value}</div>
                  <div className="mt-1 text-[15px] text-[#667085]">{label}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        {/* logo strip */}
        <Reveal className="mt-14 border-t border-[#eef0f3] pt-10">
          <div className="flex items-center justify-between">
            {logos.map(({ name, icon }) => (
              <div key={name} className="flex items-center gap-2 text-[#667085]">
                {icon}
                <span className="text-[15px] font-medium text-[#344054]">{name}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
