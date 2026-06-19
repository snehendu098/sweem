import { Logo } from "@/components/shared/logo";

const links = ["Home", "Product", "Protocol", "Pricing", "Docs"];

export function Navbar() {
  return (
    <header className="absolute inset-x-0 top-6 z-30 flex items-center justify-between px-6 md:px-12 lg:px-24">
      <Logo dark />
      <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/25 bg-white/10 p-1 backdrop-blur-md md:flex">
        {links.map((link, index) => (
          <a
            key={link}
            href={`#${link.toLowerCase()}`}
            className={
              index === 0
                ? "rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-[#1c6fd0] shadow-sm"
                : "rounded-full px-4 py-1.5 text-[13px] font-medium text-white/85 hover:text-white"
            }
          >
            {link}
          </a>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <a className="hidden text-[13px] font-medium text-white sm:inline" href="#docs">
          Docs
        </a>
        <a
          className="rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-[#101828] shadow-sm"
          href="/dashboard"
        >
          Launch App
        </a>
      </div>
    </header>
  );
}
