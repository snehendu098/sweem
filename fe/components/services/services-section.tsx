import { Reveal } from "@/components/motion/reveal";

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2a10 10 0 1 0 10 10" strokeLinecap="round" />
      <path d="M22 2l-4 4M22 2h-5M22 2v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const cards = [
  {
    title: "Bank Integration",
    desc: "Connect all your accounts effortlessly.",
    bg: "linear-gradient(135deg,#5db8f0,#2dc9b4)",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" aria-hidden>
        <path d="M3 10h18M3 10V7l9-4 9 4v3M3 10v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="9" y="14" width="6" height="6" rx="0.5" />
      </svg>
    ),
  },
  {
    title: "Instant Transfers",
    desc: "Send money instantly and securely.",
    bg: "linear-gradient(135deg,#34d399,#059669)",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" aria-hidden>
        <rect x="2" y="6" width="20" height="13" rx="2" />
        <path d="M2 10h20M6 15h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Mobile Payment",
    desc: "Accept and manage payments with ease.",
    bg: "linear-gradient(135deg,#a78bfa,#ec4899)",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" aria-hidden>
        <rect x="7" y="2" width="10" height="20" rx="2.5" />
        <circle cx="12" cy="18" r="1" fill="white" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Smart Wallet",
    desc: "Easily track and control your spending.",
    bg: "linear-gradient(135deg,#9ca3af,#374151)",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="1.8" aria-hidden>
        <rect x="2" y="5" width="20" height="15" rx="2" />
        <path d="M16 12h4M2 9h20" strokeLinecap="round" />
        <circle cx="17" cy="12" r="1" fill="white" stroke="none" />
      </svg>
    ),
  },
];

export function ServicesSection() {
  return (
    <section className="bg-white px-24 py-20">
      <div className="w-full">
        {/* header */}
        <Reveal className="mb-10 flex items-start justify-between gap-16">
          <div className="max-w-[480px]">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#1c6fd0]">
              <ServiceIcon />
              Core Service
            </p>
            <h2 className="mt-3 text-[33px] font-medium leading-[1.1] tracking-[-0.02em] text-[#101828] md:text-[42px]">
              Take full control of your{" "}
              <span className="text-[#9aa5b4]">payments with smarter</span>
            </h2>
          </div>
          <p className="mt-4 hidden max-w-[280px] shrink-0 text-[13px] leading-6 text-[#667085] md:block">
            Track spending, plan budgets, and manage your money effortlessly with intelligent financial tools built for everyday use.
          </p>
        </Reveal>

        {/* cards */}
        <div className="grid grid-cols-4 gap-4">
          {cards.map((card, i) => (
            <Reveal key={card.title} delay={i * 0.06}>
              <div className="flex h-full flex-col rounded-[18px] bg-[#f7f8fa] p-6">
                <div
                  className="grid size-12 shrink-0 place-items-center rounded-[13px]"
                  style={{ background: card.bg }}
                >
                  {card.icon}
                </div>
                <h3 className="mt-8 text-[16px] font-semibold text-[#101828]">{card.title}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-[#667085]">{card.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
