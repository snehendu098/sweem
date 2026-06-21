import { Reveal } from "@/components/motion/reveal";
import { InfiniteMovingCards, type MarqueeItem } from "@/components/ui/aceternity/infinite-moving-cards";
import { cn } from "@/lib/utils";

const BASE = "/protocols/lending";

// Circular icon mark + wordmark text.
function Mark({ src, label }: { src: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={src}
        alt=""
        className={cn(
          "size-6 shrink-0 rounded-full object-cover",
          src.includes("ondo") ? "[filter:brightness(0)_invert(1)]" : "bg-white",
        )}
      />
      <span className="whitespace-nowrap text-[15px] font-medium text-[#344054]">{label}</span>
    </div>
  );
}

// Full horizontal logo lockup (already includes the wordmark).
function Wordmark({ src, label, className }: { src: string; label: string; className?: string }) {
  return <img src={src} alt={label} className={cn("w-auto object-contain opacity-80", className)} />;
}

const ecosystem: MarqueeItem[] = [
  { name: "Sui", node: <Wordmark src={`${BASE}/Logo_Sui_Full_White.svg`} label="Sui" className="h-[22px]" /> },
  { name: "Navi", node: <Mark src={`${BASE}/navi.webp`} label="Navi" /> },
  { name: "Scallop", node: <Mark src={`${BASE}/scallop.png`} label="Scallop" /> },
  { name: "USDC", node: <Mark src={`${BASE}/usd-coin-usdc-logo.png`} label="USDC" /> },
  { name: "Cetus", node: <Wordmark src={`${BASE}/CETUS_Horizontal%20Logo.svg`} label="Cetus" className="h-[20px]" /> },
  { name: "Chainlink", node: <Mark src={`${BASE}/chainlink-link-logo.png`} label="Chainlink" /> },
  { name: "Suilend", node: <Mark src="https://unavatar.io/suilend.fi" label="Suilend" /> },
  { name: "Ondo", node: <Mark src="https://unavatar.io/ondo.finance" label="Ondo" /> },
  { name: "AlphaFi", node: <Mark src="https://unavatar.io/alphafi.xyz" label="AlphaFi" /> },
];

export function IntegrationsSection() {
  return (
    <section className="bg-white py-12">
      <Reveal className="mx-auto w-full max-w-7xl px-6 md:px-12 lg:px-24">
        <p className="mb-8 text-center text-[13px] font-medium text-text-muted">
          Powered by the Sui ecosystem
        </p>
        <InfiniteMovingCards items={ecosystem} speed="slow" />
      </Reveal>
    </section>
  );
}
