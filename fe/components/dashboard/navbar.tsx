import { Icon } from "./icons";
import { WalletButton } from "./wallet-button";

export function Navbar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-[var(--sw-border)] px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          aria-label="Toggle sidebar"
          onClick={onMenuClick}
          type="button"
          className="flex size-9 items-center justify-center rounded-lg border border-[var(--sw-border)] text-[var(--sw-text-muted)] hover:text-[var(--sw-text)] lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <p className="hidden text-[13px] text-[var(--sw-text-muted)] sm:block">
          Streaming payroll on Sui
        </p>
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
