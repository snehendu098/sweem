"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ConnectModal,
  useCurrentAccount,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { Icon, type IconName } from "../icons";

// Icon-only navigation rail (far left). Each entry maps to a real dashboard
// route; utility icons (bell/help) are decorative for now. The footer avatar is
// the wallet control — opens the connect modal when signed out, disconnects when
// signed in. Navigation + wallet wiring is unchanged from the old shell.
type RailItem = { icon: IconName; label: string; href: string };

const NAV: readonly RailItem[] = [
  { icon: "grid", label: "Overview", href: "/dashboard" },
  { icon: "customer", label: "Employees", href: "/dashboard/customers" },
  { icon: "dollar", label: "Payroll", href: "/dashboard/payments" },
];

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      className={`dx-rail-item ${active ? "dx-rail-item-active" : ""}`}
    >
      <Icon name={item.icon} size={20} strokeWidth={2.1} />
    </Link>
  );
}

export function IconRail() {
  const pathname = usePathname();
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <aside className="dx-rail">
      <Link href="/dashboard" className="dx-logo" aria-label="Dashboard home">
        B
      </Link>

      <nav className="dx-rail-nav" aria-label="Primary">
        {NAV.map((item) => (
          <RailLink key={item.label} item={item} active={isActive(item.href)} />
        ))}

        <span className="dx-rail-sep" />

        <button className="dx-rail-item" type="button" title="Notifications" aria-label="Notifications">
          <Icon name="bell" size={20} strokeWidth={2.1} />
        </button>
        <button className="dx-rail-item" type="button" title="Help" aria-label="Help">
          <Icon name="help" size={20} strokeWidth={2.1} />
        </button>
        <Link
          href="/dashboard/settings"
          className={`dx-rail-item ${isActive("/dashboard/settings") ? "dx-rail-item-active" : ""}`}
          title="Settings"
          aria-label="Settings"
        >
          <Icon name="settings" size={20} strokeWidth={2.1} />
        </Link>
      </nav>

      <div className="dx-rail-foot">
        {account ? (
          <button
            className="dx-avatar"
            type="button"
            title={`${account.address.slice(0, 6)}…${account.address.slice(-4)} — click to disconnect`}
            onClick={() => disconnect()}
          >
            {account.address.slice(2, 4).toUpperCase()}
          </button>
        ) : (
          <ConnectModal
            trigger={
              <button className="dx-avatar dx-avatar-off" type="button" title="Connect wallet">
                <Icon name="user" size={20} strokeWidth={2.2} />
              </button>
            }
          />
        )}
      </div>
    </aside>
  );
}
