"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { ActionButton, Modal } from "./ui";
import { useOrgPool } from "./use-org-pool";
import { useSweemApi, type Invoice, type InvoiceStatus } from "@/lib/api";
import { API_BASE, EXPLORER_TX } from "@/lib/sweem";
import { payInvoiceTx } from "@/lib/tx";
import { tokenBySymbol, toRaw } from "@/lib/tokens";
import { useQuery } from "@tanstack/react-query";

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  PENDING: "sweem-badge-pending",
  APPROVED: "sweem-badge-streaming",
  REJECTED: "sweem-badge-stopped",
  PAID: "sweem-badge-paused",
};

const STATUS_TABS: { label: string; value: InvoiceStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Paid", value: "PAID" },
];

function fmt(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function InvoicesScreen() {
  const { wallet, org } = useOrgPool();
  const api = useSweemApi();
  const qc = useQueryClient();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [activeTab, setActiveTab] = useState<InvoiceStatus | "ALL">("ALL");
  const [noteOpen, setNoteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ id: string; status: InvoiceStatus } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({
    queryKey: ["invoices", wallet, activeTab],
    enabled: !!wallet && !!org,
    queryFn: () => api.listOrgInvoices(wallet!, activeTab === "ALL" ? undefined : activeTab),
  });

  const counts = {
    ALL: invoices.length,
    PENDING: invoices.filter((i) => i.status === "PENDING").length,
    APPROVED: invoices.filter((i) => i.status === "APPROVED").length,
    REJECTED: invoices.filter((i) => i.status === "REJECTED").length,
    PAID: invoices.filter((i) => i.status === "PAID").length,
  };

  async function handleAction(id: string, status: InvoiceStatus) {
    if (status === "REJECTED") {
      setPendingAction({ id, status });
      setNote("");
      setNoteOpen(true);
      return;
    }
    await doUpdate(id, status, undefined);
  }

  async function doUpdate(id: string, status: InvoiceStatus, noteVal?: string) {
    if (!wallet) return;
    setBusy(true);
    try {
      await api.updateOrgInvoice(wallet, id, status, noteVal);
      await qc.invalidateQueries({ queryKey: ["invoices", wallet] });
      toast.success(`Invoice ${status.toLowerCase()}`);
    } catch {
      toast.error("Failed to update invoice");
    } finally {
      setBusy(false);
      setNoteOpen(false);
      setPendingAction(null);
    }
  }

  // Pay the employee on-chain, then submit the digest, backend verifies it.
  async function payInvoice(inv: Invoice) {
    if (!wallet) return;
    const token = tokenBySymbol(inv.token);
    if (!token) {
      toast.error(`Unsupported token: ${inv.token}`);
      return;
    }
    const recipient = inv.employee?.walletAddress;
    if (!recipient) {
      toast.error("Employee wallet missing");
      return;
    }
    setBusy(true);
    const t = toast.loading("Sending payment…");
    try {
      const tx = payInvoiceTx(recipient, toRaw(token, Number(inv.amount)), token);
      const { digest } = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest, options: { showEffects: true } });
      toast.loading("Verifying payment…", { id: t });
      await api.payOrgInvoice(wallet, inv.id, digest);
      await qc.invalidateQueries({ queryKey: ["invoices", wallet] });
      toast.success("Invoice paid", { id: t });
    } catch (e) {
      toast.error((e as Error).message ?? "Payment failed", { id: t });
    } finally {
      setBusy(false);
    }
  }

  const pendingInvoices = invoices.filter((i) => i.status === "PENDING");

  async function approveAll() {
    if (!wallet || pendingInvoices.length === 0) return;
    setBusy(true);
    try {
      await api.bulkUpdateOrgInvoices(
        wallet,
        pendingInvoices.map((i) => ({ id: i.id, status: "APPROVED" as InvoiceStatus })),
      );
      await qc.invalidateQueries({ queryKey: ["invoices", wallet] });
      toast.success(`Approved ${pendingInvoices.length} invoice${pendingInvoices.length > 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to approve invoices");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5 text-[14px] text-[var(--sw-text)] outline-none placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]";

  return (
    <DashboardPageShell title="Invoices">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`dashboard-screen-action ${activeTab === t.value ? "dashboard-screen-action-primary" : "dashboard-screen-action-secondary"}`}
              onClick={() => setActiveTab(t.value)}
            >
              {t.label}
              <span className="ml-1.5 rounded-full bg-[var(--sw-border)] px-1.5 py-0.5 text-[11px] tabular-nums">
                {counts[t.value]}
              </span>
            </button>
          ))}
        </div>
        {pendingInvoices.length > 0 && (
          <ActionButton variant="primary" onClick={approveAll} disabled={busy}>
            Approve all pending ({pendingInvoices.length})
          </ActionButton>
        )}
      </div>

      {isLoading ? (
        <div className="dashboard-data-table-wrap sweem-tablecard mt-4 py-6 text-center text-[13px] text-[var(--sw-text-dim)]">
          Loading…
        </div>
      ) : invoices.length === 0 ? (
        <div className="dashboard-data-table-wrap sweem-tablecard mt-4 py-6 text-center text-[13px] text-[var(--sw-text-dim)]">
          No invoices yet.
        </div>
      ) : (
        <div className="dashboard-data-table-wrap sweem-tablecard mt-4">
          <table className="sweem-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Token</th>
                  <th>Due</th>
                  <th>Submitted</th>
                  <th>Attachment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-medium">{inv.employee?.alias ?? "—"}</td>
                    <td className="max-w-[200px] truncate text-[var(--sw-text-dim)]">{inv.description}</td>
                    <td className="tabular-nums">{Number(inv.amount).toLocaleString()}</td>
                    <td>{inv.token}</td>
                    <td>{fmt(inv.dueDate)}</td>
                    <td>{fmt(inv.createdAt)}</td>
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
                    <td>
                      <span className={`sweem-badge ${STATUS_BADGE[inv.status]}`}>{inv.status}</span>
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        {inv.status === "PENDING" && (
                          <>
                            <ActionButton onClick={() => handleAction(inv.id, "APPROVED")} disabled={busy}>
                              Approve
                            </ActionButton>
                            <ActionButton onClick={() => handleAction(inv.id, "REJECTED")} disabled={busy}>
                              Reject
                            </ActionButton>
                          </>
                        )}
                        {inv.status === "APPROVED" && (
                          <ActionButton variant="primary" onClick={() => payInvoice(inv)} disabled={busy}>
                            Pay
                          </ActionButton>
                        )}
                        {inv.status === "PAID" && (
                          inv.txHash ? (
                            <a
                              href={EXPLORER_TX(inv.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[12px] text-[var(--sw-mint)] underline"
                            >
                              View tx
                            </a>
                          ) : (
                            <span className="text-[12px] text-[var(--sw-text-dim)]">Paid</span>
                          )
                        )}
                        {inv.status === "REJECTED" && (
                          <span className="text-[12px] text-[var(--sw-text-dim)]">{inv.note ?? "—"}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      )}

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Reject invoice"
        subtitle="Optionally add a note for the employee."
        footer={
          <>
            <ActionButton onClick={() => setNoteOpen(false)}>Cancel</ActionButton>
            <ActionButton
              variant="primary"
              disabled={busy}
              onClick={() => pendingAction && doUpdate(pendingAction.id, "REJECTED", note || undefined)}
            >
              Confirm reject
            </ActionButton>
          </>
        }
      >
        <textarea
          className={`${inputCls} min-h-[80px] resize-none`}
          placeholder="Reason (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Modal>
    </DashboardPageShell>
  );
}
