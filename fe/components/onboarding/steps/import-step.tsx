"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import type { SweemApi } from "../onboarding-wizard";
import { Card, GhostButton, PrimaryButton } from "../ui";
import {
  parseCsvFile,
  applyMapping,
  revalidate,
  toBulkInput,
  type ParsedCsv,
  type ParsedEmployee,
} from "@/lib/csv";
import { cn } from "@/lib/utils";

type Phase = "upload" | "mapping" | "preview";

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
  const [source, setSource] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }
    setPhase("mapping");
    try {
      const csv: ParsedCsv = await parseCsvFile(file);
      const sample = csv.rows.slice(0, 3);
      const { mapping, defaults, source } = await api.mapCsv(csv.headers, sample);
      const parsed = applyMapping(csv, mapping, defaults);
      setRows(parsed);
      setSource(source);
      setPhase("preview");
    } catch (e) {
      toast.error((e as Error).message);
      setPhase("upload");
    }
  }

  function updateRow(i: number, patch: Partial<ParsedEmployee>) {
    setRows((prev) => prev.map((r, j) => (j === i ? revalidate({ ...r, ...patch }) : r)));
  }

  async function handleSubmit() {
    const payload = toBulkInput(rows);
    if (payload.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.bulkAddEmployees(wallet, payload);
      await qc.invalidateQueries({ queryKey: ["employees", wallet] });
      const dupes = res.skipped.length ? `, ${res.skipped.length} duplicate skipped` : "";
      toast.success(`Imported ${res.created} employee${res.created === 1 ? "" : "s"}${dupes}`);
      onNext();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---- upload ----
  if (phase === "upload") {
    return (
      <Card
        title="Import your team"
        subtitle="Upload a CSV of employees. Our AI maps your columns automatically — any format works."
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
      </Card>
    );
  }

  // ---- mapping (AI working) ----
  if (phase === "mapping") {
    return (
      <Card title="Reading your CSV" subtitle="Our AI is figuring out which column is which…">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-4 py-6">
          <Loader2 className="size-5 animate-spin text-[var(--sw-mint)]" />
          <span className="text-[13.5px] text-[var(--sw-text-muted)]">Mapping columns…</span>
        </div>
      </Card>
    );
  }

  // ---- preview ----
  const readyCount = rows.filter((r) => r.errors.length === 0).length;
  return (
    <Card
      title="Review imported employees"
      subtitle={
        <>
          <Sparkles className="mr-1 inline size-3.5 text-[var(--sw-mint)]" />
          AI-mapped {rows.length} row{rows.length === 1 ? "" : "s"} ({source}). Fix any flagged
          rows — only valid rows are imported.
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
      <div className="-mx-1 max-h-[46vh] overflow-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-y-1.5 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
              <th className="px-2 font-medium">Name</th>
              <th className="px-2 font-medium">Wallet</th>
              <th className="px-2 font-medium">USDC</th>
              <th className="px-2 font-medium">Type</th>
              <th className="px-2 font-medium">Group</th>
              <th className="px-2 font-medium">Status</th>
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ok = r.errors.length === 0;
              return (
                <tr key={i} className="align-top">
                  <td className="px-1">
                    <input
                      className={cellCls}
                      value={r.alias}
                      onChange={(e) => updateRow(i, { alias: e.target.value })}
                    />
                  </td>
                  <td className="px-1">
                    <input
                      className={cn(cellCls, "font-mono w-[150px]")}
                      value={r.wallet_address}
                      onChange={(e) => updateRow(i, { wallet_address: e.target.value })}
                    />
                  </td>
                  <td className="px-1">
                    <input
                      className={cn(cellCls, "w-[72px]")}
                      value={r.rate_amount ?? ""}
                      onChange={(e) =>
                        updateRow(i, {
                          rate_amount: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="px-1">
                    <select
                      className={cn(cellCls, "w-[88px]")}
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
                      className={cn(cellCls, "w-[96px]")}
                      value={r.group_name ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateRow(i, { group_name: e.target.value || null })
                      }
                    />
                  </td>
                  <td className="px-2 py-2">
                    {ok ? (
                      <span className="rounded-md bg-[rgba(196,245,107,0.16)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--sw-mint)]">
                        Ready
                      </span>
                    ) : (
                      <span
                        className="rounded-md bg-[rgba(255,120,120,0.14)] px-1.5 py-0.5 text-[11px] font-medium text-[#ff9b9b]"
                        title={r.errors.join(", ")}
                      >
                        {r.errors[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-2">
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

const cellCls =
  "w-full rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2 py-1.5 text-[12.5px] text-[var(--sw-text)] outline-none focus:border-[var(--sw-border-strong)]";
