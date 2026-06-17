"use client";

import type { ReactNode } from "react";

// Small shared primitives for the Sweem dashboard screens. Styled with the
// `.sweem-*` classes (which reuse the dashboard --dash-* tokens) so everything
// matches the existing dashboard look.

export function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="sweem-stat">
      <p className="sweem-stat-label">{label}</p>
      <div className={`sweem-stat-value ${mono ? "sweem-stat-value-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`dashboard-screen-action dashboard-screen-action-${variant}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="sweem-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="sweem-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="sweem-modal-title">{title}</h2>
        {subtitle ? <p className="sweem-modal-sub">{subtitle}</p> : null}
        <div className="mt-4 flex flex-col gap-3">{children}</div>
        {footer ? <div className="sweem-actions mt-5 justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}

// One protocol leg inside an invest dialog: checkbox + live APR + amount input.
export function ProtocolRow({
  name,
  apy,
  checked,
  onChecked,
  amount,
  onAmount,
}: {
  name: string;
  apy: number | undefined;
  checked: boolean;
  onChecked: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  return (
    <div className="sweem-protocol-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChecked(e.target.checked)}
        className="h-4 w-4 accent-[var(--dash-blue)]"
      />
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-[color:var(--dash-text)]">{name}</p>
        <p className="sweem-hint">
          Live APR: {apy == null ? "…" : `${apy.toFixed(2)}%`}
        </p>
      </div>
      <input
        type="number"
        inputMode="decimal"
        className="sweem-input w-32"
        placeholder="USDC"
        value={amount}
        disabled={!checked}
        onChange={(e) => onAmount(e.target.value)}
      />
    </div>
  );
}

export function ConnectGate({ message }: { message: string }) {
  return <div className="sweem-gate">{message}</div>;
}
