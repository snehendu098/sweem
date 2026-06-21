"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, Loader2, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import type { SweemApi } from "../onboarding-wizard";
import type { BulkResult } from "@/lib/api";
import { Card, GhostButton, PrimaryButton } from "../ui";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import {
  parseCsvFile,
  ingestCsv,
  revalidate,
  toBulkInput,
  fieldLabel,
  type ParsedCsv,
  type ParsedEmployee,
  type IngestResult,
} from "@/lib/csv";
import { TOKEN_SYMBOLS, TOKENS, type TokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

type Phase = "upload" | "parsing" | "preview" | "done";

// Demo team — real Sui addresses with tiny monthly salaries (each <= $1)
// so the whole flow can be tried on mainnet for a few cents total.
const DEMO_TEAM: { alias: string; wallet: string; rate: number; group: string }[] = [
  { alias: "Alex Rivera", wallet: "0xfd5cffd7d18ca0597af1a43649adb389ba4d668aa4ba286a55c9d16bc9bd9142", rate: 0.3, group: "Engineering" },
  { alias: "Mia Chen", wallet: "0x84af37f4f89106409e26e3fa8f87428327f18813595c12f02c878a9fe8ce035b", rate: 0.25, group: "Design" },
];

export function ImportStep({
  api,
  wallet,
  onNext,
}: {
  api: SweemApi;
  wallet: string;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("upload");
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<ParsedEmployee[]>([]);
  const [meta, setMeta] = useState<Omit<IngestResult, "rows"> | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<BulkResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }
    setPhase("parsing");
    try {
      const csv: ParsedCsv = await parseCsvFile(file);
      // Fetch the current roster (public GET, no signature) so we can flag rows
      // that will UPDATE an existing employee vs create a new one.
      let existingWallets = new Set<string>();
      try {
        const roster = await api.listEmployees(wallet);
        existingWallets = new Set(roster.map((e) => e.walletAddress.toLowerCase()));
      } catch {
        /* fresh org or unreachable, treat everyone as new */
      }
      const result = ingestCsv(csv, existingWallets);
      setRows(result.rows);
      setMeta({ resolutions: result.resolutions, ignoredHeaders: result.ignoredHeaders, totalRows: result.totalRows });
      setExisting(existingWallets);
      setPhase("preview");
    } catch (e) {
      toast.error((e as Error).message);
      setPhase("upload");
    }
  }

  async function loadDemo() {
    setPhase("parsing");
    let existingWallets = new Set<string>();
    try {
      const roster = await api.listEmployees(wallet);
      existingWallets = new Set(roster.map((e) => e.walletAddress.toLowerCase()));
    } catch {
      /* fresh org */
    }
    const demoRows = DEMO_TEAM.map((d) =>
      revalidate(
        {
          alias: d.alias,
          wallet_address: d.wallet,
          email: null,
          group_name: d.group,
          rate_amount: d.rate,
          rate_type: "MONTHLY",
          token: "USDC",
          errors: [],
          warnings: [],
          action: "new",
        },
        existingWallets
      )
    );
    setRows(demoRows);
    setMeta(null);
    setExisting(existingWallets);
    setPhase("preview");
  }

  function updateRow(i: number, patch: Partial<ParsedEmployee>) {
    setRows((prev) => prev.map((r, j) => (j === i ? revalidate({ ...r, ...patch }, existing) : r)));
  }

  async function handleSubmit() {
    const payload = toBulkInput(rows);
    if (payload.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    setSubmitting(true);
    try {
      // The bulk endpoint accepts up to 1000 rows per request; chunk larger
      // imports and aggregate the report so big files still go through.
      const CHUNK = 1000;
      const agg: BulkResult = { created: 0, updated: 0, skipped: [], failed: [] };
      for (let i = 0; i < payload.length; i += CHUNK) {
        const res = await api.bulkAddEmployees(wallet, payload.slice(i, i + CHUNK));
        agg.created += res.created;
        agg.updated += res.updated ?? 0;
        agg.failed.push(...(res.failed ?? []));
      }
      await qc.invalidateQueries({ queryKey: ["employees", wallet] });
      setReport(agg);
      setPhase("done");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- upload ----
  if (phase === "upload") {
    return (
      <div className="mx-auto w-full max-w-2xl">
      <Card
        title="Import your team"
        subtitle="Upload a CSV of employees. Columns are mapped automatically, in any format or order."
        footer={
          <>
            <span className="text-[12px] text-[var(--sw-text-dim)]">Step 2 of 4 · optional</span>
            <GhostButton onClick={onNext}>Skip for now</GhostButton>
          </>
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
            dragging
              ? "border-[var(--sw-mint)] bg-[rgba(196,245,107,0.06)]"
              : "border-[var(--sw-border)] hover:border-[var(--sw-border-strong)]"
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-[var(--sw-card-inset)]">
            <Upload className="size-5 text-[var(--sw-text-muted)]" strokeWidth={2} />
          </span>
          <span className="text-[14px] font-medium text-[var(--sw-text)]">
            Drop your CSV here, or click to browse
          </span>
          <span className="text-[12px] text-[var(--sw-text-dim)]">
            Columns like name, wallet address, salary, email, team
          </span>
        </button>

        {/* demo shortcut */}
        <div className="mt-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--sw-border)]" />
          <span className="text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">or</span>
          <span className="h-px flex-1 bg-[var(--sw-border)]" />
        </div>
        <button
          type="button"
          onClick={loadDemo}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-4 py-3 text-[13px] font-medium text-[var(--sw-text)] transition-colors hover:border-[var(--sw-border-strong)]"
        >
          <Sparkles className="size-4 text-[var(--sw-mint)]" strokeWidth={2} />
          Load demo team
          <span className="rounded-md bg-[rgba(196,245,107,0.16)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--sw-mint)]">
            under $1 total
          </span>
        </button>
      </Card>
      </div>
    );
  }

  // ---- parsing ----
  if (phase === "parsing") {
    return (
      <div className="mx-auto w-full max-w-2xl">
      <Card title="Reading your CSV" subtitle="Mapping columns and validating rows…">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-4 py-6">
          <Loader2 className="size-5 animate-spin text-[var(--sw-mint)]" />
          <span className="text-[13.5px] text-[var(--sw-text-muted)]">Processing…</span>
        </div>
      </Card>
      </div>
    );
  }

  // ---- done (import report) ----
  if (phase === "done" && report) {
    const failedRows = report.failed ?? [];
    return (
      <div className="mx-auto w-full max-w-2xl">
      <Card
        title="Import complete"
        subtitle="Here's how your CSV was processed."
        footer={
          <>
            <GhostButton onClick={() => setPhase("upload")}>Import another</GhostButton>
            <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-2.5">
          <Stat label="Imported" value={report.created} tone="mint" />
          <Stat label="Updated" value={report.updated ?? 0} tone="blue" />
          <Stat label="Failed" value={failedRows.length} tone={failedRows.length ? "red" : "muted"} />
        </div>
        {failedRows.length > 0 && (
          <div data-lenis-prevent className="mt-4 max-h-[28vh] overflow-auto overscroll-contain rounded-xl border border-[var(--sw-border)]">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-[var(--sw-card-inset)] text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Wallet</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {failedRows.map((f, i) => (
                  <tr key={i} className="border-t border-[var(--sw-border)]">
                    <td className="px-3 py-2 font-mono text-[var(--sw-text-muted)]">
                      {f.wallet_address ? `${f.wallet_address.slice(0, 10)}…` : "—"}
                    </td>
                    <td className="px-3 py-2 text-[#ff9b9b]">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    );
  }

  // ---- preview ----
  const counts = { new: 0, update: 0, invalid: 0 };
  for (const r of rows) counts[r.action]++;
  const readyCount = counts.new + counts.update;

  return (
    <Card
      title="Review imported employees"
      subtitle={
        <>
          Mapped {rows.length} row{rows.length === 1 ? "" : "s"}. Fix any flagged rows, valid rows are
          created or updated on import.
        </>
      }
      footer={
        <>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[var(--sw-text-dim)]">
              {readyCount}/{rows.length} ready
            </span>
            <GhostButton onClick={() => setPhase("upload")}>Re-upload</GhostButton>
          </div>
          <div className="flex items-center gap-2">
            <GhostButton onClick={onNext}>Skip</GhostButton>
            <PrimaryButton onClick={handleSubmit} loading={submitting} disabled={readyCount === 0}>
              Import {readyCount}
            </PrimaryButton>
          </div>
        </>
      }
    >
      {/* mapping summary */}
      {meta && (
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
            {meta.resolutions.map((res) => (
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
          {meta.ignoredHeaders.length > 0 && (
            <p className="mt-2.5 text-[11.5px] text-[var(--sw-text-dim)]">
              Ignored columns: {meta.ignoredHeaders.join(", ")}
            </p>
          )}
        </div>
      )}

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
                    <input
                      className={errCls(has("name"))}
                      value={r.alias}
                      onChange={(e) => updateRow(i, { alias: e.target.value })}
                    />
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
                      onChange={(e) =>
                        updateRow(i, {
                          rate_amount: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-1">
                    <TokenSelect value={r.token} onChange={(t) => updateRow(i, { token: t })} />
                  </td>
                  <td className="px-1">
                    <select
                      className={cn(errCls(false), "w-[88px]")}
                      value={r.rate_type}
                      onChange={(e) =>
                        updateRow(i, { rate_type: e.target.value as "MONTHLY" | "HOURLY" })
                      }
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
    </Card>
  );
}

// Token picker that shows a logo + symbol. The menu is portaled so the table's
// overflow container doesn't clip it.
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
            className="fixed z-[60] overflow-hidden rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card)] p-1 shadow-xl"
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
        className="inline-flex items-center gap-1 rounded-md bg-[rgba(120,170,255,0.16)] px-1.5 py-1 text-[11px] font-medium text-[#8fb8ff]"
        title="Matches an existing employee, will be updated"
      >
        <RefreshCw className="size-3" /> Update
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(196,245,107,0.16)] px-1.5 py-1 text-[11px] font-medium text-[var(--sw-mint)]">
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

function Stat({ label, value, tone }: { label: string; value: number; tone: "mint" | "blue" | "red" | "muted" }) {
  const color =
    tone === "mint"
      ? "text-[var(--sw-mint)]"
      : tone === "blue"
        ? "text-[#8fb8ff]"
        : tone === "red"
          ? "text-[#ff9b9b]"
          : "text-[var(--sw-text-muted)]";
  return (
    <div className="rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3 text-center">
      <p className={cn("text-[24px] font-semibold tabular-nums leading-none", color)}>{value}</p>
      <p className="mt-1 text-[11.5px] text-[var(--sw-text-dim)]">{label}</p>
    </div>
  );
}

const baseCell =
  "w-full rounded-lg border bg-[var(--sw-card-inset)] px-2 py-1.5 text-[12.5px] text-[var(--sw-text)] outline-none";
function errCls(invalid: boolean) {
  return cn(
    baseCell,
    invalid ? "border-[#ff6b6b] focus:border-[#ff6b6b]" : "border-[var(--sw-border)] focus:border-[var(--sw-border-strong)]"
  );
}
