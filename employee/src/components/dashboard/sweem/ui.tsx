"use client";

import type { ReactNode } from "react";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";

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

// Quick-fill chips (25/50/75/Max) that pick a fraction of `max` for an amount field.
export function PercentChips({
  max,
  onPick,
  disabled,
}: {
  max: number;
  onPick: (value: number) => void;
  disabled?: boolean;
}) {
  const opts = [25, 50, 75, 100];
  const pick = (pct: number) =>
    onPick(pct === 100 ? max : Math.round(((max * pct) / 100) * 1e6) / 1e6);
  return (
    <div className="flex gap-1.5">
      {opts.map((pct) => (
        <button
          key={pct}
          type="button"
          disabled={disabled || max <= 0}
          onClick={() => pick(pct)}
          className="rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)] hover:text-[var(--sw-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pct === 100 ? "Max" : `${pct}%`}
        </button>
      ))}
    </div>
  );
}

// One protocol leg inside an invest dialog: checkbox + live APR + amount input.
// Pass `max` to show 25/50/75/Max quick-fill chips beneath the input.
export function ProtocolRow({
  name,
  apy,
  checked,
  onChecked,
  amount,
  onAmount,
  symbol = "USDC",
  max,
}: {
  name: string;
  apy: number | undefined;
  checked: boolean;
  onChecked: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
  symbol?: string;
  max?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="sweem-protocol-row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-4 w-4 accent-[var(--dash-blue)]"
        />
        <ProtocolLogo name={name} size={26} />
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
          placeholder={symbol}
          value={amount}
          disabled={!checked}
          onChange={(e) => onAmount(e.target.value)}
        />
      </div>
      {max != null && checked && (
        <div className="flex justify-end">
          <PercentChips max={max} onPick={(v) => onAmount(String(v))} />
        </div>
      )}
    </div>
  );
}

// One destination leg in the Claim & Allocate sheet: a colored dot, label/hint,
// a percentage slider, and the live token amount. Pass no `onPct` to render a
// read-only row (used for the wallet leg, which is the implicit remainder).
export function AllocRow({
  label,
  hint,
  pct,
  amount,
  symbol = "USDC",
  accent,
  onPct,
  max = 100,
}: {
  label: string;
  hint?: ReactNode;
  pct: number;
  amount: number;
  symbol?: string;
  accent?: string;
  onPct?: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="sweem-protocol-row items-center">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: accent ?? "var(--sw-text)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[color:var(--dash-text)]">{label}</p>
        {hint ? <p className="sweem-hint">{hint}</p> : null}
        {onPct ? (
          <input
            type="range"
            min={0}
            max={max}
            value={pct}
            onChange={(e) => onPct(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--dash-blue)]"
          />
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-semibold tabular-nums text-[color:var(--dash-text)]">
          {pct}%
        </p>
        <p className="sweem-hint tabular-nums">{amount.toFixed(2)} {symbol}</p>
      </div>
    </div>
  );
}

export function ConnectGate({ message }: { message: string }) {
  return <div className="sweem-gate">{message}</div>;
}
