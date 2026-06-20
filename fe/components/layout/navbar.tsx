import { Logo } from "@/components/shared/logo";
import { LaunchAppButton } from "@/components/shared/launch-app-button";

const links = ["Home", "Product", "Protocol", "Pricing", "Docs"];

export function Navbar() {
  return (
    <header className="absolute inset-x-0 top-6 z-30 flex items-center justify-between px-6 md:px-12 lg:px-24">
      <Logo dark />
      <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md md:flex">
        {links.map((link, index) => (
          <a
            key={link}
            href={`#${link.toLowerCase()}`}
            className={
              index === 0
                ? "rounded-full bg-white/10 px-4 py-1.5 text-[13px] font-medium text-white shadow-sm"
                : "rounded-full px-4 py-1.5 text-[13px] font-medium text-white/60 hover:text-white"
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
        <LaunchAppButton className="rounded-full bg-[#c4f56b] px-5 py-2 text-[13px] font-semibold text-[#0a0c10] shadow-sm">
          Launch App
        </LaunchAppButton>
      </div>
    </header>
  );
}
