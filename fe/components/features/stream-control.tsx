"use client";

import { useState } from "react";

type Status = "active" | "paused" | "stopped";

const NAMES = ["Alex", "Mia", "Sam"];
const INITIAL: Status[] = ["active", "active", "paused"];

const COLOR: Record<Status, string> = {
  active: "#c4f56b",
  paused: "#f1c453",
  stopped: "#8b93a3",
};

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CtrlButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md border border-white/10 bg-white/5 text-white/65 transition-colors hover:text-white"
    >
      {children}
    </button>
  );
}

function StreamRow({ name, status, onToggle, onStop }: { name: string; status: Status; onToggle: () => void; onStop: () => void }) {
  const active = status === "active";
  const color = COLOR[status];

  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 text-[12px] font-medium text-white/70">{name}</span>

      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        {active ? (
          <span className="stream-flow absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#c4f56b] to-transparent" />
        ) : (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: status === "stopped" ? "0%" : "62%", background: `${color}66` }}
          />
        )}
      </div>

      <span className="w-1.5 shrink-0">
        <span className="block size-1.5 rounded-full" style={{ background: color, boxShadow: active ? `0 0 8px ${color}` : "none" }} />
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <CtrlButton label={active ? "Pause" : "Resume"} onClick={onToggle}>
          {active ? <PauseIcon /> : <PlayIcon />}
        </CtrlButton>
        <CtrlButton label="Stop" onClick={onStop}>
          <StopIcon />
        </CtrlButton>
      </div>
    </div>
  );
}

export function StreamControl() {
  const [statuses, setStatuses] = useState<Status[]>(INITIAL);

  const toggle = (i: number) =>
    setStatuses((s) => s.map((v, idx) => (idx === i ? (v === "active" ? "paused" : "active") : v)));
  const stop = (i: number) => setStatuses((s) => s.map((v, idx) => (idx === i ? "stopped" : v)));

  const live = statuses.filter((s) => s === "active").length;

  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-4 bg-[#0a0c10] p-5">
      <div className="flex items-center justify-between text-[11px] font-medium text-white/55">
        <span>Salary streams</span>
        <span className="text-[#c4f56b]">{live} active</span>
      </div>
      {NAMES.map((name, i) => (
        <StreamRow key={name} name={name} status={statuses[i]} onToggle={() => toggle(i)} onStop={() => stop(i)} />
      ))}
    </div>
  );
}
