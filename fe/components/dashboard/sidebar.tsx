"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "./badge";
import { Icon, type IconName } from "./icons";

type SubNavItem = {
  readonly label: string;
  readonly href: string;
};

type NavItem = {
  readonly icon: IconName;
  readonly label: string;
  readonly href: string;
  readonly badge?: string;
  /** Prefix used to determine expanded state for items with subitems. */
  readonly matchPrefix?: string;
  readonly subitems?: readonly SubNavItem[];
  /** CSS class variant for the submenu — billing and developer use different class names. */
  readonly submenuVariant?: "billing" | "developer";
};

const navItems: readonly NavItem[] = [
  { icon: "home", label: "Overview", href: "/dashboard" },
  { icon: "payment", label: "Payroll", href: "/dashboard/payments" },
  { icon: "customer", label: "Employees", href: "/dashboard/customers" },
  { icon: "link", label: "Employee portal", href: "/dashboard/portal" },
  { icon: "link", label: "Payment links", href: "/dashboard/payment-links" },
  {
    icon: "billing",
    label: "Billing",
    href: "/dashboard/billing/subscriptions",
    matchPrefix: "/dashboard/billing",
    submenuVariant: "billing",
    subitems: [
      { label: "Subscriptions", href: "/dashboard/billing/subscriptions" },
    ],
  },
  { icon: "invoice", label: "Invoices", href: "/dashboard/invoices" },
  { icon: "box", label: "Products", href: "/dashboard/products" },
  {
    icon: "bank",
    label: "Offramp to Bank",
    href: "/dashboard/offramp",
    badge: "New",
  },
  {
    icon: "developer",
    label: "Developer",
    href: "/dashboard/developer/api-keys",
    matchPrefix: "/dashboard/developer",
    submenuVariant: "developer",
    subitems: [
      { label: "API keys", href: "/dashboard/developer/api-keys" },
      { label: "Webhooks", href: "/dashboard/developer/webhooks" },
      { label: "Documentation", href: "/dashboard/developer/documentation" },
      { label: "API reference", href: "/dashboard/developer/api-reference" },
      { label: "Get test tokens", href: "/dashboard/developer/test-tokens" },
    ],
  },
  { icon: "settings", label: "Settings", href: "/dashboard/settings" },
] satisfies readonly NavItem[];

function getNavItemState(item: NavItem, pathname: string) {
  const isExpanded = item.matchPrefix
    ? pathname.startsWith(item.matchPrefix)
    : false;
  const isActive =
    item.href === "/dashboard"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`) || isExpanded;
  return { isExpanded, isActive };
}

function SubMenu({
  items,
  variant,
  pathname,
}: {
  items: readonly SubNavItem[];
  variant: "billing" | "developer";
  pathname: string;
}) {
  const isBilling = variant === "billing";
  const menuClass = isBilling ? "dashboard-nested-menu" : "dashboard-developer-menu";
  const linkClass = isBilling ? "dashboard-nested-link" : "dashboard-developer-link";
  const activeLinkClass = isBilling ? "dashboard-nested-link-active" : "dashboard-developer-link-active";
  const dotClass = isBilling ? "dashboard-nested-dot" : "dashboard-developer-dot";

  return (
    <div className={menuClass}>
      {items.map((item) => (
        <Link
          className={`${linkClass} ${pathname === item.href ? activeLinkClass : ""}`}
          href={item.href}
          key={item.label}
        >
          <span className={dotClass} />
          <span>{item.label}</span>
        </Link>
      ))}
    </div>
  );
}

export function Sidebar({
  open,
  collapsed,
  onToggle,
}: {
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={`dashboard-sidebar ${open ? "dashboard-sidebar-open" : ""} ${
        collapsed ? "dashboard-sidebar-collapsed" : ""
      }`}
    >
      <nav aria-label="Primary" className="dashboard-nav">
        {navItems.map((item) => {
          const { isExpanded, isActive } = getNavItemState(item, pathname);

          return (
            <div className="dashboard-nav-group" key={item.label}>
              <Link
                title={item.label}
                aria-expanded={item.subitems ? isExpanded : undefined}
                className={`dashboard-nav-item ${
                  isActive && !isExpanded ? "dashboard-nav-item-active" : ""
                } ${isExpanded ? "dashboard-nav-item-expanded" : ""}`}
                href={item.href}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.badge ? <Badge tone="new">{item.badge}</Badge> : null}
              </Link>

              {item.subitems && isExpanded ? (
                <SubMenu
                  items={item.subitems}
                  variant={item.submenuVariant!}
                  pathname={pathname}
                />
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="dashboard-sidebar-foot">
        <button
          className="dashboard-collapse-btn"
          onClick={onToggle}
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={`dashboard-collapse-icon ${collapsed ? "is-collapsed" : ""}`}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
