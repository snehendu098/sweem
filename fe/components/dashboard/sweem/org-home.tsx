"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Icon } from "@/components/dashboard/icons";
import { Flower } from "@/components/dashboard/dx/flower";
import { CyclesChart } from "@/components/dashboard/sweem/cycles-chart";

const REFERRAL_URL = "https://www.dribbble.com/mdmostahid9";

export function OrgHome() {
  const [showPromo, setShowPromo] = useState(true);

  function copyReferralLink() {
    navigator.clipboard
      .writeText(REFERRAL_URL)
      .then(() => toast.success("Referral link copied"))
      .catch(() => toast.error("Couldn't copy link"));
  }

  return (
    <section className="dx-overview">
      <header className="dx-header">
        <div>
          <h1 className="dx-welcome-title">Welcome back, Alex 👋</h1>
          <p className="dx-welcome-sub">
            Manage your global workforce, payroll, and compliance—all in one place.
          </p>
        </div>
        <label className="dx-search">
          <Icon name="search" size={18} strokeWidth={2.2} />
          <input placeholder="Search employees, payroll..." aria-label="Search" />
          <span className="dx-kbd">⌘ K</span>
        </label>
      </header>

      <div className="dx-grid">
        <div className="dx-col">
          <div className="dx-card dx-card-tracker">
            <div className="dx-tracker-head">
              <div className="dx-card-head">
                <span className="dx-card-title">
                  <Icon name="info" size={15} strokeWidth={2.3} />
                  Payments Tracker
                </span>
              </div>

              <div className="dx-stat-grid">
                <div className="dx-stat">
                  <div className="dx-stat-top">
                    <span>Payment due</span>
                    <Icon name="warningFill" size={18} />
                  </div>
                  <div className="dx-stat-value">$54.87</div>
                  <div className="dx-stat-sub">USD · 01 invoice</div>
                </div>
                <div className="dx-stat">
                  <div className="dx-stat-top">
                    <span>Awaiting funds</span>
                    <Icon name="bankFill" size={18} />
                  </div>
                  <div className="dx-stat-value">$3.5M</div>
                  <div className="dx-stat-sub">USD · 02 Payments</div>
                </div>
              </div>
            </div>

            <div className="dx-section-label dx-invoice-label">Pending invoices details</div>
            <div className="dx-alert">
              <div className="dx-alert-title">
                <Icon name="warningFill" size={18} />
                Payment due
              </div>
              <p className="dx-alert-text">
                The following invoices must be paid before Dec 22nd 2026 to avoid
                possible complications or delays to payroll
              </p>
            </div>

            <div className="dx-due-row">
              <UsdcLogo size={32} />
              <div className="dx-due-main">
                <div className="dx-due-title">229 invoices due</div>
                <div className="dx-due-meta">
                  Due date: <b>Dec 22nd 2025</b>
                </div>
              </div>
              <Link href="/dashboard/payments" className="dx-btn-primary">
                Review and Pay
              </Link>
            </div>
          </div>

          <div className="dx-card dx-quick-card">
            <div className="dx-section-label">Quick Access</div>
            <QuickRow
              icon="workerFill"
              chip="dx-chip-orange"
              title="Add a worker"
              sub="Add a new worker to your organization"
              href="/dashboard/customers"
            />
            <QuickRow
              icon="expenseFill"
              chip="dx-chip-purple"
              title="Add expenses or other adjustments"
              sub="Add worker adjustments individually or bulk upload entries."
              href="/dashboard/payments"
            />
            <QuickRow
              icon="milestoneFill"
              chip="dx-chip-blue"
              title="Add milestones"
              sub="Add milestones for a single worker or bulk upload for multiple workers"
              href="/dashboard/products"
            />
          </div>
        </div>

        <div className="dx-col">
          <div className="dx-card dx-pad dx-cycles-card">
            <div className="dx-card-head">
              <span className="dx-card-title">Cycles Tracker</span>
              <button className="dx-pill" type="button">
                Manage <Icon name="chevronDown" size={13} strokeWidth={2.4} />
              </button>
            </div>

            <CyclesChart />
          </div>

          <div className="dx-card dx-pad">
            <div className="dx-card-head dx-top-card-head">
              <div>
                <div className="dx-card-title">For you today</div>
                <div className="dx-card-sub">To-dos that require your attention</div>
              </div>
              <button className="dx-pill" type="button">
                Manage <Icon name="chevronDown" size={13} strokeWidth={2.4} />
              </button>
            </div>

            <TodoRow
              icon={<Icon name="dataFill" size={22} />}
              chip="dx-chip-orange"

              title="Data Updates"
              sub="Latest platform changes requiring your attention."
              href="/dashboard/settings"
            />
            <TodoRow
              icon={<Icon name="submissionFill" size={22} />}
              chip="dx-chip-green"

              title="Contractors' Submissions"
              sub="New contractor documents ready for review."
              href="/dashboard/customers"
            />
            <TodoRow
              icon={<Icon name="expenseFill" size={22} />}
              chip="dx-chip-yellow"

              title="Expense Approvals"
              sub="Pending expense requests awaiting your approval."
              href="/dashboard/payments"
            />
          </div>
        </div>

        <div className="dx-col dx-col-3">
          <div className="dx-card dx-earn">
            <div className="dx-earn-top">
              <span className="dx-earn-pill">Get 1,500 and give 500!</span>
              <Flower size={142} />
              <h2 className="dx-earn-title">Earn Referrals</h2>
              <p className="dx-earn-subtitle">Refer businesses and earn rewards.</p>
            </div>

            <div className="dx-section-label dx-how-label">How it works:</div>
            <div className="dx-steps">
              <div className="dx-step">
                <span className="dx-step-num">1</span>
                Invite A Business To Explore Fello
              </div>
              <div className="dx-step">
                <span className="dx-step-num">2</span>
                Your Referral Signs Up And Connects With Deel
              </div>
              <div className="dx-step">
                <span className="dx-step-num">3</span>
                Earn Rewards Through Successful Referrals.
              </div>
            </div>

            <div className="dx-link-field">
              <span className="dx-link-url">{REFERRAL_URL}</span>
              <button className="dx-btn-dark" onClick={copyReferralLink} type="button">
                Copy Link <Icon name="link" size={14} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* Promo card hidden for now — kept intact for later use.
          {showPromo && (
            <div className="dx-card dx-pad dx-promo-card">
              <div className="dx-promo-head">
                <span className="dx-card-title">Maximize your Deel experience</span>
                <button
                  className="dx-promo-close"
                  onClick={() => setShowPromo(false)}
                  type="button"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
              <div className="dx-promo-inner">
                <span className="dx-quick-icon dx-chip-orange">
                  <Icon name="team" size={20} strokeWidth={2.1} />
                </span>
                <div className="dx-promo-text">
                  <div className="dx-quick-title">Manage your global team</div>
                  <div className="dx-quick-sub">Centralized scalable people management.</div>
                </div>
                <Link href="/dashboard/customers" className="dx-btn-primary">
                  Explore
                </Link>
              </div>
              <div className="dx-promo-note">
                <Icon name="info" size={13} strokeWidth={2.2} />
                Centralized scalable people management.
              </div>
            </div>
          )}
          */}

          <div className="dx-card dx-pad">
            <div className="dx-card-head dx-top-card-head">
              <div>
                <div className="dx-card-title">Payroll Requests</div>
                <div className="dx-card-sub">Payroll requests for Dec cycle.</div>
              </div>
              <button className="dx-pill" type="button">
                Wayne Enterpris... <Icon name="chevronDown" size={13} strokeWidth={2.4} />
              </button>
            </div>

            <RequestRow
              icon="giftFill"
              chip="dx-chip-yellow"
              title="Bonus Payout Request"
              sub="Bonus request pending approval."
              badge="Pending"
              badgeClass="dx-badge-pending"
            />
            <RequestRow
              icon="uploadFill"
              chip="dx-chip-purple"
              title="Bulk Upload Processed"
              sub="Payroll entries uploaded and verified successfully."
              badge="Completed"
              badgeClass="dx-badge-done"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// Official USDC coin mark (static asset in /public).
function UsdcLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      className="dx-usdc"
      src="/usdc.svg"
      width={size}
      height={size}
      alt="USDC"
    />
  );
}

function QuickRow({
  icon,
  chip,
  title,
  sub,
  href,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  chip: string;
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <Link href={href} className="dx-quick-row">
      <span className={`dx-quick-icon ${chip}`}>
        <Icon name={icon} size={19} strokeWidth={2.1} />
      </span>
      <div>
        <div className="dx-quick-title">{title}</div>
        <div className="dx-quick-sub">{sub}</div>
      </div>
    </Link>
  );
}

function TodoRow({
  icon,
  chip,
  title,
  sub,
  href,
}: {
  icon: ReactNode;
  chip: string;
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <div className="dx-todo-row">
      <span className={`dx-todo-icon ${chip}`}>{icon}</span>
      <div className="dx-todo-main">
        <div className="dx-todo-title">{title}</div>
        <div className="dx-todo-sub">{sub}</div>
      </div>
      <Link href={href} className="dx-btn-outline">
        Review
      </Link>
    </div>
  );
}

function RequestRow({
  icon,
  chip,
  title,
  sub,
  badge,
  badgeClass,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  chip: string;
  title: string;
  sub: string;
  badge: string;
  badgeClass: string;
}) {
  return (
    <div className="dx-todo-row dx-request-row">
      <span className={`dx-todo-icon ${chip}`}>
        <Icon name={icon} size={19} strokeWidth={2.1} />
      </span>
      <div className="dx-todo-main">
        <div className="dx-todo-title">{title}</div>
        <div className="dx-todo-sub">{sub}</div>
      </div>
      <span className={`dx-badge ${badgeClass}`}>{badge}</span>
    </div>
  );
}

