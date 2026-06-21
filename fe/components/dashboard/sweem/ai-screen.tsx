"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUp,
  Loader2,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";

import { API_BASE, MONTH_MS } from "@/lib/sweem";
import { TOKENS } from "@/lib/tokens";
import { useSweemApi, type BulkEmployeeInput, type AddEmployeeInput } from "@/lib/api";
import { parseCsvFile, ingestCsv, toBulkInput, type IngestResult } from "@/lib/csv";
import { CsvPreview } from "./csv-preview";
import {
  pauseStreamTx,
  resumeStreamTx,
  depositTx,
  type EmployeeStream,
} from "@/lib/tx";
import { cn } from "@/lib/utils";
import { useOrgPool } from "./use-org-pool";
import { useAgentContext } from "./use-agent-context";
import {
  EmployeeListCard,
  EmployeeDetailCard,
  PayrollChartCard,
  ProtocolInfoCard,
  SdkInfoCard,
  ActionConfirmCard,
  ToolLoadingCard,
  type PendingAction,
} from "./agent-cards";

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Show all employees",
  "Payroll breakdown by group",
  "Which streams haven't started?",
  "How does Sweem yield work?",
];

// ── Tool name → display label ─────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  listEmployees: "Loading employees…",
  getEmployeeDetails: "Searching employees…",
  analyzePayroll: "Analyzing payroll…",
  getProtocolInfo: "Loading protocol info…",
  getSdkInfo: "Loading SDK info…",
  prepareAddEmployee: "Preparing action…",
  prepareBulkAddFromCsv: "Preparing bulk import…",
  preparePauseStream: "Preparing pause…",
  prepareResumeStream: "Preparing resume…",
  prepareStartStream: "Preparing stream start…",
  prepareEditEmployee: "Preparing edit…",
  respondWithText: "",
};

// ── Main screen ───────────────────────────────────────────────────────────────

export function AiScreen() {
  const [input, setInput] = useState("");
  const [csvPreview, setCsvPreview] = useState<IngestResult | null>(null);
  const [existingWallets, setExistingWallets] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const account = useCurrentAccount();
  const wallet = account?.address;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const qc = useQueryClient();

  const api = useSweemApi();
  const context = useAgentContext(); // only walletAddress, server fetches org data from DB
  const { poolIdByToken } = useOrgPool();

  // Ref keeps context fresh on every send without recreating transport
  const contextRef = useRef(context);
  useEffect(() => { contextRef.current = context; }, [context]);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${API_BASE}/v1/ai/chat`, body: () => ({ context: contextRef.current }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // ── Action execution ────────────────────────────────────────────────────────

  const executeAction = useCallback(
    async (action: PendingAction) => {
      if (!wallet) {
        toast.error("Connect wallet first");
        return;
      }

      if (action.action === "pauseStream") {
        const { employeeWallet, token, poolId } = action.data as {
          employeeWallet: string; token: string; poolId?: string;
        };
        if (!poolId) { toast.error("Pool not found for this token"); return; }
        const tx = pauseStreamTx(poolId, employeeWallet, TOKENS[token as keyof typeof TOKENS]);
        await signAndExecute({ transaction: tx });
        toast.success("Stream paused");
        qc.invalidateQueries({ queryKey: ["poolState"] });
        return;
      }

      if (action.action === "resumeStream") {
        const { employeeWallet, token, poolId } = action.data as {
          employeeWallet: string; token: string; poolId?: string;
        };
        if (!poolId) { toast.error("Pool not found for this token"); return; }
        const tx = resumeStreamTx(poolId, employeeWallet, TOKENS[token as keyof typeof TOKENS]);
        await signAndExecute({ transaction: tx });
        toast.success("Stream resumed");
        qc.invalidateQueries({ queryKey: ["poolState"] });
        return;
      }

      if (action.action === "startStream") {
        const { token, poolId, employees: emps } = action.data as {
          token: string; poolId?: string; employees: Array<{ walletAddress: string; rates: Array<{ token: string; rateAmount: string; rateType: string }> }>;
        };
        if (!poolId) { toast.error("No pool found, create one first"); return; }
        const tokenCfg = TOKENS[token as keyof typeof TOKENS];
        const streams: EmployeeStream[] = emps.map((e) => {
          const rate = e.rates.find((r) => r.token === token);
          const rateAmount = Number(rate?.rateAmount ?? 0);
          const rateRaw = BigInt(Math.round(rateAmount * 10 ** tokenCfg.decimals));
          return { address: e.walletAddress, rateRaw, periodMs: BigInt(MONTH_MS) };
        });
        const totalRaw = streams.reduce((s, e) => s + e.rateRaw, 0n);
        const tx = depositTx(poolId, totalRaw, streams, tokenCfg);
        await signAndExecute({ transaction: tx });
        toast.success("Streams started");
        qc.invalidateQueries({ queryKey: ["poolState"] });
        return;
      }

      if (action.action === "addEmployee") {
        const d = action.data as {
          alias: string; wallet_address: string; email?: string;
          rate_amount: number; rate_type: "MONTHLY" | "HOURLY"; token: string; group_name?: string;
        };
        const input: AddEmployeeInput = {
          alias: d.alias,
          wallet_address: d.wallet_address,
          email: d.email,
          rates: [{ token: d.token, rate_amount: d.rate_amount, rate_type: d.rate_type }],
        };
        await api.addEmployee(wallet, input);
        qc.invalidateQueries({ queryKey: ["employees"] });
        toast.success(`Added ${d.alias}`);
        return;
      }

      if (action.action === "bulkAdd") {
        const rows = action.data as Array<{
          alias: string; wallet_address: string; email?: string;
          rate_amount?: number; rate_type?: string; token?: string; group_name?: string;
        }>;
        const employees: BulkEmployeeInput[] = rows.map((r) => ({
          alias: r.alias,
          wallet_address: r.wallet_address,
          email: r.email,
          group_name: r.group_name,
          rates: r.rate_amount
            ? [{ token: r.token ?? "USDC", rate_amount: r.rate_amount, rate_type: (r.rate_type ?? "MONTHLY") as "MONTHLY" | "HOURLY" }]
            : [],
        }));
        const result = await api.bulkAddEmployees(wallet, employees);
        qc.invalidateQueries({ queryKey: ["employees"] });
        toast.success(`Imported ${result.created} employees (${result.skipped.length} skipped)`);
        return;
      }

      if (action.action === "editEmployee") {
        const { employeeId, changes } = action.data as {
          employeeId: string; alias: string;
          changes: { rate_amount?: number; rate_type?: string; token?: string; group_name?: string };
        };
        if (changes.rate_amount != null) {
          await api.updateEmployee(wallet, employeeId, {
            rates: [{
              token: changes.token ?? "USDC",
              rate_amount: changes.rate_amount,
              rate_type: (changes.rate_type ?? "MONTHLY") as "MONTHLY" | "HOURLY",
            }],
          });
          qc.invalidateQueries({ queryKey: ["employees"] });
          toast.success("Employee updated");
        }
        return;
      }
    },
    [wallet, api, signAndExecute, qc, client]
  );

  // ── CSV file drop ───────────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast.error("Please upload a .csv file");
        return;
      }
      try {
        const csv = await parseCsvFile(file);
        // Flag rows that will update an existing employee vs create a new one.
        let ew = new Set<string>();
        if (wallet) {
          try {
            const roster = await api.listEmployees(wallet);
            ew = new Set(roster.map((e) => e.walletAddress.toLowerCase()));
          } catch {
            /* fresh org / unreachable */
          }
        }
        setExistingWallets(ew);
        setCsvPreview(ingestCsv(csv, ew));
      } catch (err) {
        toast.error((err as Error).message || "Failed to parse CSV");
      }
    },
    [api, wallet]
  );

  // Hand the reviewed rows to the AI as a message so it can act on them.
  const insertCsv = useCallback(
    (rows: Parameters<typeof toBulkInput>[0]) => {
      const employees = toBulkInput(rows);
      if (employees.length === 0) { toast.error("No valid rows to insert"); return; }
      sendMessage({
        text: `Here are ${employees.length} employees from a CSV I reviewed. Please prepare to bulk-add them:\n\n${JSON.stringify(employees, null, 2)}`,
      });
      setCsvPreview(null);
    },
    [sendMessage]
  );

  const importCsv = useCallback(
    async (rows: Parameters<typeof toBulkInput>[0]) => {
      if (!wallet) { toast.error("Connect wallet first"); return; }
      const payload = toBulkInput(rows);
      if (payload.length === 0) { toast.error("No valid rows to import"); return; }
      setImporting(true);
      try {
        const CHUNK = 1000;
        let created = 0;
        let updated = 0;
        for (let i = 0; i < payload.length; i += CHUNK) {
          const res = await api.bulkAddEmployees(wallet, payload.slice(i, i + CHUNK));
          created += res.created;
          updated += res.updated ?? 0;
        }
        qc.invalidateQueries({ queryKey: ["employees"] });
        toast.success(`Imported ${created}${updated ? `, updated ${updated}` : ""} employee${created + updated === 1 ? "" : "s"}`);
        setCsvPreview(null);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setImporting(false);
      }
    },
    [api, wallet, qc]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".csv")) processFile(file);
      else toast.error("Drop a .csv file");
    },
    [processFile]
  );

  // ── Send ────────────────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!input.trim() || status !== "ready") return;
    sendMessage({ text: input.trim() });
    setInput("");
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className="relative flex min-h-[calc(100vh-60px)] flex-col px-4 sm:px-6"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="rounded-[24px] border-2 border-dashed border-[var(--sw-mint)] bg-[var(--sw-card)]/90 px-12 py-8 text-center">
              <p className="text-[18px] font-semibold text-[var(--sw-mint)]">Drop CSV here</p>
              <p className="mt-1 text-[13px] text-[var(--sw-text-dim)]">We&apos;ll map the columns and show a preview to review</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between pt-4">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
          Ask AI
        </h1>
        <button
          type="button"
          onClick={() => setMessages([])}
          className="flex items-center gap-1.5 rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
        >
          <Plus className="size-4" strokeWidth={2.6} />
          New chat
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className={cn(
          "relative z-10 mx-auto w-full max-w-3xl flex-1 overflow-y-auto",
          isEmpty && !csvPreview ? "flex flex-col items-center justify-center pb-16" : "py-6"
        )}
      >
        {csvPreview ? (
          <div className="rounded-2xl border border-[var(--sw-border)] bg-[var(--sw-card)] p-4 sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--sw-text)]">Review CSV import</h2>
                <p className="text-[12.5px] text-[var(--sw-text-muted)]">
                  Mapped {csvPreview.totalRows} row{csvPreview.totalRows === 1 ? "" : "s"}. Edit any flagged rows, then import.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCsvPreview(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            <CsvPreview
              result={csvPreview}
              existingWallets={existingWallets}
              importing={importing}
              onImport={importCsv}
              onInsert={insertCsv}
              onCancel={() => {
                setCsvPreview(null);
                fileRef.current?.click();
              }}
            />
          </div>
        ) : isEmpty ? (
          <>
            {/* Hero */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 180, damping: 22 }}
              className="relative mx-auto flex size-[140px] items-center justify-center"
            >
              <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(196,245,107,0.22),transparent_70%)] blur-xl" />
              <Image src="/sweem.png" alt="Sweem" width={112} height={112} priority className="relative size-28" />
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.05 }}
              className="mt-6 text-center text-[34px] font-semibold tracking-[-0.02em] sm:text-[40px]"
            >
              <span className="text-[var(--sw-text-dim)]">Hello, what&apos;s on </span>
              <span className="text-[var(--sw-text)]">your mind?</span>
            </motion.h2>
            {/* Suggestion chips */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-6 flex flex-wrap justify-center gap-2"
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { sendMessage({ text: s }); }}
                  className="rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-1.5 text-[13px] text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)] hover:text-[var(--sw-text)]"
                >
                  {s}
                </button>
              ))}
            </motion.div>
          </>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              // CSV "Insert into chat" messages carry an employees JSON array —
              // render them as a table instead of raw JSON.
              const inserted =
                msg.role === "user"
                  ? parseInsertedEmployees(
                      msg.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n")
                    )
                  : null;
              if (inserted) {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <InsertedEmployeesTable rows={inserted} />
                  </div>
                );
              }
              return (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    msg.role === "user" ? "max-w-[85%]" : "w-full",
                    msg.role === "user" && "rounded-[18px] border border-[var(--sw-mint)]/30 bg-[var(--sw-card)] px-4 py-2.5"
                  )}
                >
                  {msg.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <p key={i} className={cn(
                          "whitespace-pre-wrap text-[14px] leading-relaxed",
                          msg.role === "user" ? "text-[var(--sw-text)]" : "text-[var(--sw-text-muted)]"
                        )}>
                          {part.text}
                        </p>
                      );
                    }

                    // Tool parts, identify by type prefix
                    const toolType = part.type as string;

                    // Loading state (skip for respondWithText, no spinner needed)
                    if ("state" in part && (part.state === "input-streaming" || part.state === "input-available") && toolType !== "tool-respondWithText") {
                      const label = TOOL_LABELS[toolType.replace("tool-", "")] ?? "Working…";
                      return <ToolLoadingCard key={i} label={label} />;
                    }

                    // Output available
                    if ("state" in part && part.state === "output-available" && "output" in part) {
                      const output = part.output as Record<string, unknown>;

                      if (toolType === "tool-listEmployees") {
                        return <EmployeeListCard key={i} data={output as Parameters<typeof EmployeeListCard>[0]["data"]} />;
                      }
                      if (toolType === "tool-getEmployeeDetails") {
                        return <EmployeeDetailCard key={i} data={output as Parameters<typeof EmployeeDetailCard>[0]["data"]} />;
                      }
                      if (toolType === "tool-analyzePayroll") {
                        return <PayrollChartCard key={i} data={output as Parameters<typeof PayrollChartCard>[0]["data"]} />;
                      }
                      if (toolType === "tool-getProtocolInfo") {
                        return <ProtocolInfoCard key={i} data={output as Parameters<typeof ProtocolInfoCard>[0]["data"]} />;
                      }
                      if (toolType === "tool-getSdkInfo") {
                        return <SdkInfoCard key={i} />;
                      }
                      // respondWithText → render as plain assistant text
                      if (toolType === "tool-respondWithText") {
                        return (
                          <p key={i} className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
                            {(output as { text: string }).text}
                          </p>
                        );
                      }
                      // All prepare* tools return a pendingAction or error
                      if (toolType.startsWith("tool-prepare")) {
                        return (
                          <ActionConfirmCard
                            key={i}
                            result={output as PendingAction | { error: true; message: string }}
                            onConfirm={executeAction}
                          />
                        );
                      }
                    }

                    return null;
                  })}
                </div>
              </div>
              );
            })}
            {status === "submitted" && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 text-[13px] text-[var(--sw-text-dim)]">
                  <Loader2 className="size-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input area, sticky at bottom */}
      <div className="relative z-10 mx-auto w-full max-w-3xl pb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 190, damping: 26 }}
          className={cn(
            "flex min-h-[120px] flex-col rounded-[24px] border bg-[var(--sw-card)] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]",
            isDragging
              ? "border-[var(--sw-mint)]"
              : "border-[var(--sw-border)] focus-within:border-[var(--sw-border-strong)]"
          )}
        >
          <div className="relative flex-1">
            {!input && (
              <div className="pointer-events-none absolute left-1 top-0 text-[15px] text-[var(--sw-text-dim)]">
                Ask anything, employees, streams, payroll…
              </div>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={3}
              className="w-full resize-none bg-transparent px-1 text-[15px] text-[var(--sw-text)] outline-none"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
              >
                <Paperclip className="size-[15px]" strokeWidth={2} />
                Attach CSV
              </button>
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || status !== "ready"}
              className={cn(
                "flex size-9 items-center justify-center rounded-full transition-colors",
                input.trim() && status === "ready"
                  ? "bg-[var(--sw-mint)] text-black hover:bg-[#cef77f]"
                  : "bg-[var(--sw-card-inset)] text-[var(--sw-text-dim)]"
              )}
            >
              {status === "streaming" || status === "submitted" ? (
                <Loader2 className="size-[18px] animate-spin" />
              ) : (
                <ArrowUp className="size-[18px]" strokeWidth={2.4} />
              )}
            </button>
          </div>
        </motion.div>
        <p className="mt-2 text-center text-[11px] text-[var(--sw-text-dim)]">
          Drag & drop a CSV to import employees · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

// ── Inserted CSV → table ────────────────────────────────────────────────────────

type InsertedEmployee = {
  alias: string;
  wallet_address: string;
  email?: string | null;
  group_name?: string | null;
  rates?: { token: string; rate_amount: number; rate_type: string }[];
};

// Extract the employees JSON array from an "Insert into chat" message, or null.
function parseInsertedEmployees(text: string): InsertedEmployee[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.every((e) => e && typeof e === "object" && "alias" in e && "wallet_address" in e)
    ) {
      return arr as InsertedEmployee[];
    }
  } catch {
    /* not an employees payload */
  }
  return null;
}

function InsertedEmployeesTable({ rows }: { rows: InsertedEmployee[] }) {
  const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
  return (
    <div className="w-full max-w-full overflow-hidden rounded-[18px] border border-[var(--sw-mint)]/30 bg-[var(--sw-card)] p-3">
      <p className="mb-2 px-1 text-[12px] font-medium text-[var(--sw-text-muted)]">
        {rows.length} employee{rows.length === 1 ? "" : "s"} from CSV
      </p>
      <div data-lenis-prevent className="max-h-[40vh] overflow-auto overscroll-contain">
        <table className="w-full border-separate border-spacing-y-1 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)] [&>th]:px-2 [&>th]:pb-1 [&>th]:font-medium">
              <th>Name</th>
              <th>Wallet</th>
              <th>Rate</th>
              <th>Type</th>
              <th>Group</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rate = r.rates?.[0];
              return (
                <tr key={i} className="bg-[var(--sw-card-inset)] [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg">
                  <td className="px-2 py-1.5 text-[var(--sw-text)]">{r.alias}</td>
                  <td className="px-2 py-1.5 font-mono text-[var(--sw-text-muted)]">{short(r.wallet_address)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-[var(--sw-text)]">
                    {rate ? `${rate.rate_amount} ${rate.token}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--sw-text-muted)]">
                    {rate ? (rate.rate_type === "HOURLY" ? "Hourly" : "Monthly") : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--sw-text-muted)]">{r.group_name || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
