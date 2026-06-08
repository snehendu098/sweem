import { Reveal } from "@/components/motion/reveal";

function Sparkle({ size = 22, className }: { size?: number; className: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="white"
      className={`absolute ${className}`}
      aria-hidden
    >
      <path d="M10 0 L12.2 7.8 L20 10 L12.2 12.2 L10 20 L7.8 12.2 L0 10 L7.8 7.8 Z" />
    </svg>
  );
}

export function CtaSection() {
  return (
    <section className="bg-white px-24 py-12">
      <Reveal className="w-full">
        <div
          className="relative overflow-hidden rounded-[28px] px-8 py-28 text-center text-white"
          style={{
            background: `
              radial-gradient(ellipse 55% 60% at 8% 105%, rgba(255,255,255,0.97) 0%, transparent 52%),
              radial-gradient(ellipse 48% 52% at 42% 118%, rgba(255,255,255,0.92) 0%, transparent 50%),
              radial-gradient(ellipse 52% 58% at 76% 108%, rgba(255,255,255,0.90) 0%, transparent 52%),
              radial-gradient(ellipse 38% 42% at 97% 92%, rgba(255,255,255,0.82) 0%, transparent 46%),
              linear-gradient(180deg, #3282cc 0%, #4492dc 28%, #64acec 55%, #a8d2f4 72%, #d4ecfa 84%, #eef7fd 100%)
            `,
          }}
        >
          <Sparkle size={24} className="left-[11%] top-[22%]" />
          <Sparkle size={16} className="right-[8%] top-[40%]" />
          <Sparkle size={14} className="bottom-[22%] left-[28%] opacity-80" />

          <div className="relative z-10">
            <p className="inline-flex items-center gap-2 text-[12px] font-medium text-white/85">
              <span className="size-1.5 rounded-full bg-white/90" />
              Start Growing Today
            </p>
            <h2 className="mx-auto mt-3 text-[33px] font-medium leading-[1.1] tracking-[-0.02em] md:text-[42px]">
              Build Your Financial Future<br />with Confidence
            </h2>
            <p className="mx-auto mt-4 max-w-[460px] text-[13px] leading-6 text-white/80">
              Smart tools to save more, invest smarter, and stay in control of your money.
            </p>
            <button className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-[13px] font-medium text-[#101828]">
              Get Started
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
