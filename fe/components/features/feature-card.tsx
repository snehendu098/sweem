function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 15.5l-5-5L5 20.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type FeatureCardProps = {
  lead: string;
  rest: string;
  /** Tailwind aspect-ratio class for the image placeholder, e.g. "aspect-[3/2]" */
  aspect: string;
  align?: "left" | "center";
  large?: boolean;
};

export function FeatureCard({ lead, rest, aspect, align = "center", large = false }: FeatureCardProps) {
  return (
    <div className="rounded-[22px] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)] ring-1 ring-[#eef0f3]">
      {/* image placeholder — replace with an <img> of the same box size */}
      <div className={`grid w-full place-items-center rounded-[16px] bg-[#f1f2f4] ${aspect}`}>
        <ImageIcon className="size-9 text-[#cbd0d8]" />
      </div>
      <p
        className={`px-2 pb-2 pt-4 text-[#101828] ${align === "center" ? "text-center" : "text-left"} ${
          large ? "text-[16px] leading-[1.4]" : "text-[13px] leading-[1.55]"
        }`}
      >
        <span className="font-semibold">{lead}</span> {rest}
      </p>
    </div>
  );
}
