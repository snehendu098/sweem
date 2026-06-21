"use client";

import { useState } from "react";
import { Code2, Puzzle, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { LaunchAppButton } from "@/components/shared/launch-app-button";
import { cn } from "@/lib/utils";

type MenuItem = { name: string; sub: string; icon?: LucideIcon; logo?: string; soon?: boolean };
type Menu = { title: string; desc: string; items: MenuItem[] };

const MENUS: Record<string, Menu> = {
  Product: {
    title: "The Sweem platform",
    desc: "Stream payroll by the second and earn yield on idle cash. Run it from the dashboard, embed checkout with the SDK, or pay from your browser.",
    items: [
      { name: "Sweem", sub: "Streaming payroll on Sui", logo: "/sweem.png" },
      { name: "Checkout SDK", sub: "@sweem/sdk · accept USDC & SUI", icon: Code2 },
      { name: "Chrome Extension", sub: "Pay from your browser", icon: Puzzle, soon: true },
    ],
  },
  Protocol: {
    title: "Powered by the Sui ecosystem",
    desc: "Idle payroll auto-invests across leading Sui lending protocols and keeps earning until the moment it is claimed.",
    items: [
      { name: "Navi", sub: "6.4% APY", logo: "/protocols/lending/navi.webp" },
      { name: "Scallop", sub: "5.8% APY", logo: "/protocols/lending/scallop.png" },
      { name: "Suilend", sub: "7.1% APY", logo: "https://unavatar.io/suilend.fi" },
      { name: "Ondo", sub: "5.2% APY", logo: "https://unavatar.io/ondo.finance" },
      { name: "AlphaFi", sub: "6.0% APY", logo: "https://unavatar.io/alphafi.xyz" },
    ],
  },
};

const links = ["Home", "Product", "Protocol", "Docs"];

export function Navbar() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <header className="absolute inset-x-0 top-6 z-30 flex items-center justify-between px-6 md:px-12 lg:px-24">
      <Logo dark />

      {/* center nav + hover mega-menu */}
      <div
        className="absolute left-1/2 hidden -translate-x-1/2 md:block"
        onMouseLeave={() => setOpen(null)}
      >
        <nav className="flex items-center gap-1 rounded-full p-1">
          {links.map((link) => {
            const hasMenu = !!MENUS[link];
            return (
              <a
                key={link}
                href={`#${link.toLowerCase()}`}
                onMouseEnter={() => setOpen(hasMenu ? link : null)}
                className="rounded-full px-4 py-1.5 text-[13px] font-medium text-white/60 transition-colors hover:text-white"
              >
                {link}
              </a>
            );
          })}
        </nav>

        {open && MENUS[open] && (
          <div className="absolute left-1/2 top-full w-[min(92vw,720px)] -translate-x-1/2 pt-3">
            <MegaMenu menu={MENUS[open]} />
          </div>
        )}
      </div>

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

function MegaMenu({ menu }: { menu: Menu }) {
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-[20px] border border-white/10 bg-[#14161b]/95 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl sm:grid-cols-[0.85fr_1.15fr]">
      {/* left — intro */}
      <div className="border-b border-white/10 p-6 sm:border-b-0 sm:border-r">
        <p className="text-[15px] font-semibold text-white">{menu.title}</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">{menu.desc}</p>
      </div>

      {/* right — items */}
      <div className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-2">
        {menu.items.map((it) => (
          <a
            key={it.name}
            href="#product"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5"
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl",
                it.logo ? "bg-white/10" : "bg-[#c4f56b] text-[#0a0c10]",
              )}
            >
              {it.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.logo}
                  alt=""
                  className={cn(
                    "size-6 rounded-full object-cover",
                    it.logo.includes("ondo") ? "[filter:brightness(0)_invert(1)]" : "bg-white",
                  )}
                />
              ) : it.icon ? (
                <it.icon className="size-[18px]" strokeWidth={2.2} />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-white">
                {it.name}
                {it.soon && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/60">
                    Soon
                  </span>
                )}
              </span>
              <span className="block text-[11.5px] text-white/50">{it.sub}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
