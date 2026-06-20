import { Icon } from "./icons";
import { WalletButton } from "./wallet-button";

// Slim top bar for the standalone employee portal. No sidebar toggle (there is
// no sidebar) — just brand on the left, support/feedback + wallet on the right.
export function EmployeeNavbar() {
  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-[var(--sw-border)] px-4 sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--sw-mint)] text-[15px] font-bold text-black">
          S
        </span>
        <span className="text-[17px] font-semibold tracking-[-0.02em]">Sweem</span>
        <span className="hidden rounded-md bg-[var(--sw-card-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--sw-text-muted)] sm:inline">
          Portal
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="hidden items-center gap-2 rounded-full border border-[var(--sw-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] sm:flex"
        >
          <Icon name="support" size={15} strokeWidth={2.4} />
          <span>Support</span>
        </button>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-full border border-[var(--sw-border)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] sm:flex"
        >
          <Icon name="feedback" size={15} strokeWidth={2.4} />
          <span>Feedback</span>
        </button>
        <WalletButton />
      </div>
    </header>
  );
}
