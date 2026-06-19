import { Navbar } from "@/components/layout/navbar";

const avatars = ["#e7a880", "#c9a7e2", "#f1c48a"];

function GoogleIcon() {
  return (
    <span className="text-[17px] font-semibold leading-none text-white">G</span>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="white" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.49-.12-1.12.43-2.3 1.1-3.05.744-.83 2.02-1.45 3.064-1.52zm4.06 16.2c-.55 1.27-.81 1.83-1.52 2.95-.99 1.57-2.39 3.52-4.12 3.54-1.54.01-1.93-1-4.02-.99-2.09.01-2.52.99-4.06.97-1.73-.02-3.05-1.78-4.04-3.34C-.06 17.92-.32 12.5 1.7 9.86c1-1.32 2.58-2.16 4.06-2.16 1.78 0 2.9 1 4.37 1 1.43 0 2.3-1 4.36-1 1.31 0 2.7.71 3.69 1.95-3.24 1.78-2.71 6.4.25 7.98z" />
    </svg>
  );
}

export function HeroSection() {
  return (
    <section
      id="home"
      className="hero-bg relative overflow-hidden px-6 pb-32 pt-28 text-white md:px-12 lg:px-24"
    >
      {/* bg1 background image */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/bg1.png')" }}
      />
      {/* legibility + blend into the page below */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-[#0a0a0b]/35 via-transparent to-[#0a0a0b]/75"
      />

      <Navbar />

      <div className="hero-copy relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-white/30 bg-white/15 py-1 pl-1 pr-3.5 text-[12px] font-medium backdrop-blur-md">
          <div className="flex -space-x-1.5">
            {avatars.map((color) => (
              <span
                key={color}
                className="size-5 rounded-full border border-white/80"
                style={{ background: color }}
              />
            ))}
          </div>
          <span>Built for onchain teams</span>
        </div>

        <h1 className="text-[62px] font-medium leading-[1.05] tracking-[-0.025em] md:text-[82px]">
          Stream Payroll.
          <br />
          Earn on Idle Cash.
        </h1>

        <p className="mt-5 max-w-[470px] text-[14px] leading-6 text-white/85 md:text-[15px]">
          Pay your team by the second on Sui. Idle payroll auto-earns yield
          across Navi and Scallop — runway you can see, salaries employees claim
          anytime.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <a
            href="/dashboard"
            className="rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-[#101828] shadow-[0_14px_30px_rgba(4,40,80,0.18)]"
          >
            Launch Dashboard
          </a>
          <button className="grid size-12 place-items-center rounded-full border border-white/40 bg-white/15 backdrop-blur-md">
            <GoogleIcon />
          </button>
          <button className="grid size-12 place-items-center rounded-full border border-white/40 bg-white/15 backdrop-blur-md">
            <AppleIcon />
          </button>
        </div>
      </div>

      <div className="relative z-10 mx-auto mt-14 w-full max-w-5xl">
        <img
          src="/sweem-dashboard.png"
          alt="Sweem dashboard — live payroll streaming"
          width={755}
          height={493}
          className="w-full rounded-[18px] [mask-image:linear-gradient(to_bottom,black_62%,transparent_100%)]"
        />
      </div>
    </section>
  );
}
