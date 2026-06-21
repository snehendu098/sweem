"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { isValidSuiAddress } from "@mysten/sui/utils";
import { cn } from "@/lib/utils";
import { useSweemApi, type ApiKeyRow } from "@/lib/api";
import { TreasuryPanel } from "@/components/dashboard/sweem/treasury-panel";

const mask = (k: string) => `${k.slice(0, 11)}${"•".repeat(12)}${k.slice(-4)}`;
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ApiKeysPage() {
  const api = useSweemApi();
  const keys = api.apiKeysQuery.data ?? [];

  const [justCreated, setJustCreated] = useState<ApiKeyRow | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeyRow | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const snippet = `// .env
NEXT_PUBLIC_SWEEM_API_KEY=${keys[0]?.key ?? "pk_live_xxx"}

// component
import { SweemPayButton } from "@sweem/sdk";

<SweemPayButton
  apiKey={process.env.NEXT_PUBLIC_SWEEM_API_KEY!}
  amount={49.99}
  onSuccess={(r) => console.log("Paid!", r.digest)}
/>`;

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setSnippetCopied(true);
      toast.success("Snippet copied");
      setTimeout(() => setSnippetCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const create = async (projectName: string, receivingAddress?: string) => {
    setBusy(true);
    try {
      const { data } = await api.createApiKey(projectName.trim(), receivingAddress);
      if (data) setJustCreated(data as ApiKeyRow);
      await api.apiKeysQuery.refetch();
      setCreateOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create key");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (k: ApiKeyRow) => {
    try {
      await navigator.clipboard.writeText(k.key);
      setCopiedId(k.id);
      toast.success("API key copied");
      setTimeout(() => setCopiedId(null), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      if (justCreated?.id === id) setJustCreated(null);
      await api.apiKeysQuery.refetch();
      setDeleteTarget(null);
      toast("Key revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke key");
    }
  };

  return (
    <div className="dashboard-content mx-auto w-full max-w-3xl pt-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">API keys</h1>
          <p className="mt-1 text-[13.5px] text-[var(--sw-text-muted)]">
            Publishable keys for the{" "}
            <span className="font-medium text-[var(--sw-text)]">@sweem/sdk</span> SDK.
          </p>
        </div>
        {keys.length > 0 && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--sw-mint)] px-4 text-[13.5px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
          >
            <Plus className="size-4" strokeWidth={2.6} />
            Generate key
          </button>
        )}
      </div>

      {/* One-time reveal banner */}
      {justCreated && (
        <div className="mt-6 rounded-[20px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-4">
          <p className="text-[13px] font-semibold text-[var(--sw-text)]">
            “{justCreated.name}” key created
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--sw-text-muted)]">
            Copy it now and store it safely, you can always view it again here.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5">
            <code className="flex-1 truncate font-mono text-[13px] text-[var(--sw-text)]">{justCreated.key}</code>
            <button
              onClick={() => copy(justCreated)}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
            >
              {copiedId === justCreated.id ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="mt-6">
        {keys.length === 0 ? (
          <div className="rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-mint)]">
                <KeyRound className="size-[18px]" strokeWidth={2} />
              </span>
              <p className="text-[15px] font-semibold text-[var(--sw-text)]">Create your first API key</p>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--sw-text-muted)]">
              Generate a publishable key for a project, then drop it into the{" "}
              <span className="font-medium text-[var(--sw-text)]">@sweem/sdk</span> SDK to start accepting
              USDC &amp; SUI payments.
            </p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[var(--sw-mint)] py-3 text-[14px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
            >
              <Plus className="size-4" strokeWidth={2.6} />
              Generate key
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {keys.map((k) => {
              const show = revealed[k.id];
              return (
                <li
                  key={k.id}
                  className="flex items-center gap-3 rounded-[16px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-4"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sw-card-inset)] text-[var(--sw-mint)]">
                    <KeyRound className="size-[18px]" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-[var(--sw-text)]">{k.name}</p>
                    <code className="font-mono text-[12.5px] text-[var(--sw-text-muted)]">
                      {show ? k.key : mask(k.key)}
                    </code>
                    <p className="mt-0.5 text-[11.5px] text-[var(--sw-text-dim)]">
                      Pays to {shortAddr(k.receivingAddress ?? k.orgWallet)}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-[12px] text-[var(--sw-text-dim)] sm:block">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn title={show ? "Hide" : "Reveal"} onClick={() => setRevealed((r) => ({ ...r, [k.id]: !r[k.id] }))}>
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </IconBtn>
                    <IconBtn title="Copy" onClick={() => copy(k)}>
                      {copiedId === k.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </IconBtn>
                    <IconBtn title="Revoke" danger onClick={() => setDeleteTarget(k)}>
                      <Trash2 className="size-4" />
                    </IconBtn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Usage hint */}
      <div className="mt-8 rounded-[20px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">
        <p className="text-[13px] font-semibold text-[var(--sw-text)]">Use it in your app</p>
        <div className="group relative mt-3">
          <button
            type="button"
            onClick={copySnippet}
            title="Copy snippet"
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
          >
            {snippetCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
          <pre
            onClick={copySnippet}
            className="cursor-pointer overflow-x-auto rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] p-4 pr-12 text-[12.5px] leading-relaxed text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)]"
          >
            <code>{snippet}</code>
          </pre>
        </div>
      </div>

      {/* Earn yield on received payments */}
      <TreasuryPanel />

      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={create}
        existingNames={keys.map((k) => k.name.toLowerCase())}
        pending={busy}
        receivingWallet={api.address}
      />
      <ConfirmDeleteModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && revoke(deleteTarget.id)}
      />
    </div>
  );
}

function ConfirmDeleteModal({
  target,
  onClose,
  onConfirm,
}: {
  target: ApiKeyRow | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState("");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setText("");
  }, [target]);

  if (!mounted || !target) return null;
  const confirmed = text.trim().toLowerCase() === "delete";

  return createPortal(
    <div className="sw-dash fixed inset-0 z-50 flex items-center justify-center p-4 text-[var(--sw-text)]">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[420px] rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Revoke API key</h2>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">
              This permanently disables <span className="font-medium text-[var(--sw-text)]">“{target.name}”</span>.
              Apps using it will stop working immediately.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <label className="mt-5 block text-[12.5px] text-[var(--sw-text-muted)]">
          Type <span className="font-mono font-semibold text-[var(--sw-text)]">delete</span> to confirm
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmed && onConfirm()}
          placeholder="delete"
          className="mt-2 h-11 w-full rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]"
        />

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-[var(--sw-border)] text-[14px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed}
            className="h-11 flex-1 rounded-xl bg-[#ef4444] text-[14px] font-semibold text-white transition-colors hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Revoke key
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CreateKeyModal({
  open,
  onClose,
  onCreate,
  existingNames,
  pending,
  receivingWallet,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, receivingAddress?: string) => void;
  existingNames: string[];
  pending?: boolean;
  receivingWallet?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [editAddr, setEditAddr] = useState(false);
  const [addr, setAddr] = useState("");
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) {
      setName("");
      setTouched(false);
      setEditAddr(false);
      setAddr("");
    }
  }, [open]);

  if (!mounted || !open) return null;

  const trimmed = name.trim();
  // Validation: 2–40 chars, allowed characters, and not a duplicate.
  const error =
    trimmed.length === 0
      ? "Project name is required"
      : trimmed.length < 2
        ? "Use at least 2 characters"
        : trimmed.length > 40
          ? "Keep it under 40 characters"
          : !/^[\w \-.]+$/.test(trimmed)
            ? "Only letters, numbers, spaces, - . _ allowed"
            : existingNames.includes(trimmed.toLowerCase())
              ? "A key with this name already exists"
              : null;

  const addrTrim = addr.trim();
  const addrError = addrTrim && !isValidSuiAddress(addrTrim) ? "Invalid Sui address" : null;
  const effectiveAddr = addrTrim || receivingWallet || "";
  const isCustom = !!addrTrim && addrTrim.toLowerCase() !== (receivingWallet ?? "").toLowerCase();

  const valid = !error && !addrError;
  const submit = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    onCreate(trimmed, isCustom ? addrTrim : undefined);
  };

  return createPortal(
    <div className="sw-dash fixed inset-0 z-50 flex items-center justify-center p-4 text-[var(--sw-text)]">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[420px] rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Create API key</h2>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">Name the project this key belongs to.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <label className="mt-5 block text-[12.5px] font-medium text-[var(--sw-text-muted)]">Project name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Acme Storefront"
          aria-invalid={touched && !valid}
          className={cn(
            "mt-2 h-11 w-full rounded-xl border bg-[#1b1b1f] px-3.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)]",
            touched && error ? "border-[#ef4444]" : "border-[var(--sw-border)] focus:border-[var(--sw-border-strong)]",
          )}
        />
        <p className="mt-1.5 h-4 text-[12px]">
          {touched && error ? (
            <span className="text-[#ef4444]">{error}</span>
          ) : (
            <span className="text-[var(--sw-text-dim)]">{trimmed.length}/40</span>
          )}
        </p>

        {/* Payments settle to the connected account, or a custom address. */}
        <div className="mt-4 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] font-medium text-[var(--sw-text-muted)]">Payments received at</p>
            {!editAddr && (
              <button
                type="button"
                onClick={() => {
                  setAddr(addrTrim || receivingWallet || "");
                  setEditAddr(true);
                }}
                title="Edit receiving address"
                className="flex size-6 items-center justify-center rounded-md text-[var(--sw-text-dim)] transition-colors hover:bg-[var(--sw-card)] hover:text-[var(--sw-text)]"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
          {editAddr ? (
            <>
              <input
                autoFocus
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder={receivingWallet || "0x… receiving address"}
                className={cn(
                  "mt-2 h-10 w-full rounded-lg border bg-[#1b1b1f] px-3 font-mono text-[12.5px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)]",
                  addrError ? "border-[#ef4444]" : "border-[var(--sw-border)] focus:border-[var(--sw-border-strong)]"
                )}
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                {addrError ? (
                  <span className="text-[#ef4444]">{addrError}</span>
                ) : (
                  <span className="text-[var(--sw-text-dim)]">Leave blank to use this account</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAddr("");
                    setEditAddr(false);
                  }}
                  className="text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
                >
                  Reset
                </button>
              </div>
            </>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[13px] text-[var(--sw-text)]">
              {effectiveAddr ? shortAddr(effectiveAddr) : "Connect a wallet"}
              <span className="rounded-md bg-[var(--sw-card)] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[var(--sw-text-dim)]">
                {isCustom ? "Custom" : "This account"}
              </span>
            </p>
          )}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl border border-[var(--sw-border)] text-[14px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || pending}
            className="h-11 flex-1 rounded-xl bg-[var(--sw-mint)] text-[14px] font-semibold text-black transition-colors hover:bg-[#cef77f] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Creating…" : "Create key"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)]",
        danger ? "hover:text-[#ef4444]" : "hover:text-[var(--sw-text)]",
      )}
    >
      {children}
    </button>
  );
}
