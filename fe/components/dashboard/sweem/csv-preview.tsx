"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { TOKEN_SYMBOLS, TOKENS, type TokenSymbol } from "@/lib/tokens";
import { revalidate, fieldLabel, type ParsedEmployee, type IngestResult } from "@/lib/csv";
import { cn } from "@/lib/utils";

// Shared CSV import preview: mapping summary + editable, validated row table +
// import action. Used by both the onboarding wizard and the AI screen.
export function CsvPreview({
  result,
  existingWallets,
  onImport,
  importing,
  onCancel,
  onSkip,
  onInsert,
  importLabel,
}: {
  result: IngestResult;
  existingWallets?: Set<string>;
  onImport: (rows: ParsedEmployee[]) => void;
  importing?: boolean;
  onCancel?: () => void;
  onSkip?: () => void;
  onInsert?: (rows: ParsedEmployee[]) => void;
  importLabel?: string;
}) {
  const existing = existingWallets ?? new Set<string>();
  const [rows, setRows] = useState<ParsedEmployee[]>(result.rows);
  useEffect(() => setRows(result.rows), [result]);

  const updateRow = (i: number, patch: Partial<ParsedEmployee>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? revalidate({ ...r, ...patch }, existing) : r)));

  const counts = { new: 0, update: 0, invalid: 0 };
  for (const r of rows) counts[r.action]++;
  const readyCount = counts.new + counts.update;

  return (
    <div>
      {/* mapping summary */}
      <div className="mb-3 rounded-2xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--sw-text-dim)]">
            Column mapping
          </p>
          <div className="flex items-center gap-1.5">
            <CountPill tone="mint" value={counts.new} label="new" />
            {counts.update > 0 && <CountPill tone="blue" value={counts.update} label="update" />}
            {counts.invalid > 0 && <CountPill tone="red" value={counts.invalid} label="invalid" />}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {result.resolutions.map((res) => (
            <span
              key={res.field}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px]",
                res.header
                  ? "border-[var(--sw-border)] bg-[var(--sw-card)]"
                  : "border-[rgba(255,120,120,0.3)] bg-[rgba(255,120,120,0.08)]"
              )}
              title={res.header ? `Matched via ${res.via}` : "Not found in CSV"}
            >
              <span className="font-medium text-[var(--sw-text)]">{fieldLabel(res.field)}</span>
              <ArrowRight className="size-3 text-[var(--sw-text-dim)]" />
              <span className={res.header ? "text-[var(--sw-mint)]" : "text-[#ff9b9b]"}>
                {res.header ?? "not found"}
              </span>
            </span>
          ))}
        </div>
        {result.ignoredHeaders.length > 0 && (
          <p className="mt-2.5 text-[11.5px] text-[var(--sw-text-dim)]">
            Ignored columns: {result.ignoredHeaders.join(", ")}
          </p>
        )}
      </div>

      {/* table */}
      <div data-lenis-prevent className="-mx-1 max-h-[40vh] overflow-auto overscroll-contain">
        <table className="w-full min-w-[700px] border-separate border-spacing-y-1.5 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)] [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-[var(--sw-card)] [&>th]:px-2 [&>th]:pb-1.5 [&>th]:font-medium">
              <th>Name</th>
              <th>Wallet</th>
              <th>Rate</th>
              <th>Token</th>
              <th>Type</th>
              <th>Group</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const has = (kw: string) => r.errors.some((e) => e.includes(kw));
              return (
                <tr
                  key={i}
                  className={cn(
                    "align-middle [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg",
                    r.action === "invalid" && "bg-[rgba(255,107,107,0.06)]",
                    r.action === "update" && "bg-[rgba(120,170,255,0.06)]"
                  )}
                >
                  <td className="px-1">
                    <input className={errCls(has("name"))} value={r.alias} onChange={(e) => updateRow(i, { alias: e.target.value })} />
                  </td>
                  <td className="px-1">
                    <input
                      className={cn(errCls(has("wallet") || has("address")), "font-mono w-[150px]")}
                      value={r.wallet_address}
                      onChange={(e) => updateRow(i, { wallet_address: e.target.value })}
                    />
                  </td>
                  <td className="px-1">
                    <input
                      className={cn(errCls(has("rate")), "w-[72px]")}
                      value={r.rate_amount ?? ""}
                      onChange={(e) => updateRow(i, { rate_amount: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td className="px-1">
                    <TokenSelect value={r.token} onChange={(t) => updateRow(i, { token: t })} />
                  </td>
                  <td className="px-1">
                    <select
                      className={cn(errCls(false), "w-[88px]")}
                      value={r.rate_type}
                      onChange={(e) => updateRow(i, { rate_type: e.target.value as "MONTHLY" | "HOURLY" })}
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="HOURLY">Hourly</option>
                    </select>
                  </td>
                  <td className="px-1">
                    <input
                      className={cn(errCls(false), "w-[96px]")}
                      value={r.group_name ?? ""}
                      placeholder="—"
                      onChange={(e) => updateRow(i, { group_name: e.target.value || null })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <StatusBadge row={r} />
                  </td>
                  <td className="py-2 pl-1 pr-3">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      className="text-[var(--sw-text-dim)] transition-colors hover:text-[#ff9b9b]"
                      aria-label="Remove row"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* footer */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[var(--sw-text-dim)]">
            {readyCount}/{rows.length} ready
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
            >
              Re-upload
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
            >
              Skip
            </button>
          )}
          {onInsert && (
            <button
              type="button"
              onClick={() => onInsert(rows)}
              disabled={readyCount === 0 || importing}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--sw-border)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--sw-text)] transition-colors hover:border-[var(--sw-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Insert into chat
            </button>
          )}
          <button
            type="button"
            onClick={() => onImport(rows)}
            disabled={readyCount === 0 || importing}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? "Importing…" : (importLabel ?? `Import ${readyCount}`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenSelect({ value, onChange }: { value: TokenSymbol; onChange: (t: TokenSymbol) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setMenu({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 96) });
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="flex w-[92px] items-center justify-between gap-1 rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2 py-1.5 text-[12.5px] text-[var(--sw-text)] outline-none transition-colors hover:border-[var(--sw-border-strong)]"
      >
        <span className="flex items-center gap-1.5">
          <TokenIcon token={TOKENS[value]} size={16} />
          {value}
        </span>
        <ChevronDown className="size-3 shrink-0 text-[var(--sw-text-dim)]" />
      </button>
      {open &&
        menu &&
        createPortal(
          <div
            className="sw-dash fixed z-[60] overflow-hidden rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card)] p-1 shadow-xl"
            style={{ top: menu.top, left: menu.left, width: menu.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {TOKEN_SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--sw-card-inset)]",
                  s === value ? "text-[var(--sw-mint)]" : "text-[var(--sw-text)]"
                )}
              >
                <TokenIcon token={TOKENS[s]} size={16} />
                {s}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function StatusBadge({ row }: { row: ParsedEmployee }) {
  if (row.action === "invalid") {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-[rgba(255,120,120,0.14)] px-1.5 py-1 text-[11px] font-medium text-[#ff9b9b]"
        title={row.errors.join(", ")}
      >
        <AlertCircle className="size-3 shrink-0" />
        {row.errors[0]}
      </span>
    );
  }
  if (row.action === "update") {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-[rgba(120,170,255,0.16)] px-1.5 py-1 text-[11px] font-medium text-[#8fb8ff]"
        title="Matches an existing employee, will be updated"
      >
        <RefreshCw className="size-3" /> Update
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-[rgba(196,245,107,0.16)] px-1.5 py-1 text-[11px] font-medium text-[var(--sw-mint)]">
      <CheckCircle2 className="size-3" /> New
    </span>
  );
}

function CountPill({ tone, value, label }: { tone: "mint" | "blue" | "red"; value: number; label: string }) {
  const cls =
    tone === "mint"
      ? "bg-[rgba(196,245,107,0.16)] text-[var(--sw-mint)]"
      : tone === "blue"
        ? "bg-[rgba(120,170,255,0.16)] text-[#8fb8ff]"
        : "bg-[rgba(255,120,120,0.14)] text-[#ff9b9b]";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>
      <span className="tabular-nums">{value}</span>
      <span className="font-medium opacity-80">{label}</span>
    </span>
  );
}

const baseCell = "w-full rounded-lg border bg-[var(--sw-card-inset)] px-2 py-1.5 text-[12.5px] text-[var(--sw-text)] outline-none";
function errCls(invalid: boolean) {
  return cn(
    baseCell,
    invalid ? "border-[#ff6b6b] focus:border-[#ff6b6b]" : "border-[var(--sw-border)] focus:border-[var(--sw-border-strong)]"
  );
}
