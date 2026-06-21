"use client";

import { useRef, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSweemApi, type Invoice, type InvoiceStatus, type EmployeeOrgEntry } from "@/lib/api";
import { SweemCard, CardLabel } from "@/components/sweem-ui/primitives";
import { ActionButton, Modal } from "./ui";
import { API_BASE } from "@/lib/sweem";
import { TOKENS, type TokenSymbol } from "@/lib/tokens";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  PENDING: "sweem-badge-pending",
  APPROVED: "sweem-badge-streaming",
  REJECTED: "sweem-badge-stopped",
  PAID: "sweem-badge-paused",
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const inputCls =
  "w-full rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5 text-[14px] text-[var(--sw-text)] outline-none placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]";

export function InvoicesSection() {
  const account = useCurrentAccount();
  const wallet = account?.address;
  const api = useSweemApi();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("USDC");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [dueOpen, setDueOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: orgs = [] } = useQuery<EmployeeOrgEntry[]>({
    queryKey: ["employeeOrgs", wallet],
    enabled: !!wallet,
    queryFn: () => api.listEmployeeOrgs(wallet!),
  });

  const activeOrg = selectedOrg || orgs[0]?.orgWallet || "";

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["employeeInvoices", wallet, activeOrg],
    enabled: !!wallet && !!activeOrg,
    queryFn: () => api.listEmployeeInvoices(wallet!, activeOrg),
  });

  function openForm() {
    setAmount("");
    setToken("USDC");
    setDescription("");
    setDueDate(undefined);
    setFile(null);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!activeOrg || !amount || !token || !description) {
      toast.error("Fill all required fields");
      return;
    }
    setBusy(true);
    try {
      await api.submitInvoice(
        {
          org_wallet: activeOrg,
          amount: Number(amount),
          token: token.trim().toUpperCase(),
          description,
          due_date: dueDate ? format(dueDate, "yyyy-MM-dd") : undefined,
        },
        file,
      );
      toast.success("Invoice submitted");
      setFormOpen(false);
      await qc.invalidateQueries({ queryKey: ["employeeInvoices", wallet, activeOrg] });
    } catch {
      toast.error("Failed to submit invoice");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) return null;

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <CardLabel className="text-[17px] text-[var(--sw-text)]">Invoices</CardLabel>
          {orgs.length > 1 && (
            <select
              className="rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[13px] text-[var(--sw-text)] outline-none"
              value={activeOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.orgWallet} value={o.orgWallet}>{o.orgName}</option>
              ))}
            </select>
          )}
        </div>
        <ActionButton variant="primary" onClick={openForm} disabled={!activeOrg}>
          + New invoice
        </ActionButton>
      </div>

      <SweemCard>
        {isLoading ? (
          <p className="py-4 text-center text-[13px] text-[var(--sw-text-dim)]">Loading…</p>
        ) : invoices.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[var(--sw-text-dim)]">No invoices yet.</p>
        ) : (
          <div className="dashboard-data-table-wrap sweem-tablecard">
            <table className="sweem-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Token</th>
                  <th>Due</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th>Attachment</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="max-w-[180px] truncate">{inv.description}</td>
                    <td className="tabular-nums">{Number(inv.amount).toLocaleString()}</td>
                    <td>{inv.token}</td>
                    <td>{fmt(inv.dueDate)}</td>
                    <td>{fmt(inv.createdAt)}</td>
                    <td>
                      <span className={`sweem-badge ${STATUS_BADGE[inv.status]}`}>{inv.status}</span>
                    </td>
                    <td className="text-[var(--sw-text-dim)]">{inv.note ?? "—"}</td>
                    <td>
                      {inv.attachmentKey ? (
                        <a
                          href={`${API_BASE}/v1/attachments/${inv.attachmentKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-[var(--sw-mint)] underline"
                        >
                          View
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SweemCard>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New invoice"
        subtitle="Submit an expense or reimbursement request to your organisation."
        footer={
          <>
            <ActionButton onClick={() => setFormOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" onClick={handleSubmit} disabled={busy}>
              {busy ? "Submitting…" : "Submit"}
            </ActionButton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--sw-text-dim)]">Amount *</label>
            <input
              className={inputCls}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder="100"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
              }}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-[var(--sw-text-dim)]">Token *</label>
            <Select value={token} onValueChange={(v) => setToken(v as TokenSymbol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["USDC", "SUI"] as TokenSymbol[]).map((sym) => (
                  <SelectItem key={sym} value={sym}>
                    <span className="flex items-center gap-2">
                      <TokenIcon token={TOKENS[sym]} size={18} />
                      {sym}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--sw-text-dim)]">Reason *</label>
          <textarea
            className={`${inputCls} min-h-[72px] resize-none`}
            placeholder="e.g. Travel expenses for client visit on Jun 20"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--sw-text-dim)]">Due date</label>
          <Popover open={dueOpen} onOpenChange={setDueOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`${inputCls} flex items-center justify-between ${dueDate ? "" : "text-[var(--sw-text-dim)]"}`}
              >
                {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                <CalendarIcon className="size-4 text-[var(--sw-text-muted)]" />
              </button>
            </PopoverTrigger>
            <PopoverContent>
              <Calendar
                mode="single"
                selected={dueDate}
                onSelect={(d) => {
                  setDueDate(d);
                  setDueOpen(false);
                }}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-[var(--sw-text-dim)]">Receipt / document</label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-3 text-[13px] text-[var(--sw-text-dim)] transition-colors hover:border-[var(--sw-border-strong)]"
          >
            {file ? (
              <span className="truncate text-[var(--sw-text)]">{file.name}</span>
            ) : (
              "Click to upload PDF or image (max 10 MB)"
            )}
          </button>
        </div>
      </Modal>
    </section>
  );
}
