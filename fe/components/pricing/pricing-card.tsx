function CheckCircle() {
  return (
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[#22c55e]">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth="3" aria-hidden>
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

type PricingCardProps = {
  name: string;
  subtitle: string;
  price: string;
  period?: string;
  cta: string;
  featured?: boolean;
  features: string[];
};

export function PricingCard({ name, subtitle, price, period = "/ yearly", cta, featured = false, features }: PricingCardProps) {
  return (
    <article className={`flex h-full flex-col rounded-[20px] p-6 ${
      featured
        ? "bg-white ring-2 ring-[#1c6fd0] shadow-[0_24px_60px_rgba(28,111,208,0.12)]"
        : "bg-[#f7f8fa] ring-1 ring-[#eef0f3]"
    }`}>
      <div>
        <h3 className="text-[17px] font-semibold text-[#101828]">{name}</h3>
        <p className="mt-1 text-[13px] text-[#667085]">{subtitle}</p>
      </div>

      <div className="mt-6 flex items-end gap-1.5">
        <span className="text-[38px] font-semibold tracking-[-0.03em] text-[#101828] leading-none">{price}</span>
        <span className="mb-1 text-[12px] text-[#98a2b3]">{period}</span>
      </div>

      <button className={`mt-5 h-12 w-full rounded-full text-[13px] font-medium transition-colors ${
        featured
          ? "bg-[#0a0e16] text-white hover:bg-[#1a2030]"
          : "bg-white text-[#344054] ring-1 ring-[#d0d5dd] hover:bg-[#f9fafb]"
      }`}>
        {cta}
      </button>

      <ul className="mt-6 space-y-3.5 border-t border-[#eef0f3] pt-6">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#344054]">
            <CheckCircle />
            {f}
          </li>
        ))}
      </ul>
    </article>
  );
}
