"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowUp,
  ChevronDown,
  FolderPlus,
  Globe,
  Mic,
  Paperclip,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AiScreen() {
  const [value, setValue] = useState("");

  const send = () => {
    if (!value.trim()) return;
    toast("Sweem AI is coming soon", {
      description: "Conversational payroll assistant is on the way.",
    });
  };

  return (
    <div className="relative flex min-h-[calc(100vh-60px)] flex-col px-4 sm:px-6">
      {/* Header */}
      <div className="relative z-10 flex items-center justify-between pt-4">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Ask AI</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toast("Search coming soon")}
            className="hidden items-center gap-2 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2 text-[13px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] sm:flex"
          >
            <Search className="size-4" strokeWidth={2} />
            Search thread
          </button>
          {/* <button
            type="button"
            onClick={() => toast("Folders coming soon")}
            className="hidden items-center gap-2 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2 text-[13px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] sm:flex"
          >
            <FolderPlus className="size-4" strokeWidth={2} />
            Create folder
          </button> */}
          <button
            type="button"
            onClick={() => setValue("")}
            className="flex items-center gap-1.5 rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
          >
            <Plus className="size-4" strokeWidth={2.6} />
            New chat
          </button>
        </div>
      </div>

      {/* Centered hero + composer */}
      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center pb-16">
        {/* Brand mark with glow */}
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

        {/* Composer */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 190, damping: 26, delay: 0.1 }}
          className="mt-8 flex min-h-[176px] flex-col rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)] focus-within:border-[var(--sw-border-strong)]"
        >
          <div className="relative flex-1">
            {!value && (
              <div className="pointer-events-none absolute left-1 top-0 flex flex-wrap items-center gap-2 text-[15px]">
                {/* <Sparkles className="size-4 text-[var(--sw-mint)]" strokeWidth={2} /> */}
                <span className="text-[var(--sw-text)]">Ask me anything — I&apos;m your AI assistant</span>
                <span className="text-[var(--sw-text-dim)]">with advanced capabilities!</span>
              </div>
            )}
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={4}
              className="w-full resize-none bg-transparent px-1 text-[15px] text-[var(--sw-text)] outline-none"
            />
          </div>

          {/* Toolbar */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <ToolbarButton icon={<Paperclip className="size-[15px]" strokeWidth={2} />} label="Attach" onClick={() => toast("Attachments coming soon")} />
              <ToolbarButton icon={<Globe className="size-[15px]" strokeWidth={2} />} label="Search" onClick={() => toast("Search coming soon")} />
              <span className="mx-1 h-4 w-px bg-[var(--sw-border)]" />
              <ToolbarButton
                icon={null}
                label="Writing Styles"
                trailing={<ChevronDown className="size-3.5" strokeWidth={2.2} />}
                onClick={() => toast("Writing styles coming soon")}
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toast("Voice coming soon")}
                title="Voice"
                className="flex size-9 items-center justify-center rounded-full text-[var(--sw-text-dim)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
              >
                <Mic className="size-[18px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!value.trim()}
                title="Send"
                className={cn(
                  "flex size-9 items-center justify-center rounded-full transition-colors",
                  value.trim()
                    ? "bg-[var(--sw-mint)] text-black hover:bg-[#cef77f]"
                    : "bg-[var(--sw-card-inset)] text-[var(--sw-text-dim)]"
                )}
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
    >
      {icon}
      {label}
      {trailing}
    </button>
  );
}
