export function Logo({ dark = false }: { dark?: boolean }) {
  const mark = dark ? "#ffffff" : "#1c6fd0";
  return (
    <div className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2 L21 7 L12 12 L3 7 Z" fill={mark} />
        <path d="M3 7 L12 12 L12 22 L3 17 Z" fill={mark} fillOpacity="0.72" />
        <path d="M21 7 L12 12 L12 22 L21 17 Z" fill={mark} fillOpacity="0.5" />
      </svg>
      <span className={`text-[18px] font-semibold tracking-tight ${dark ? "text-white" : "text-[#101828]"}`}>
        Finexa
      </span>
    </div>
  );
}
