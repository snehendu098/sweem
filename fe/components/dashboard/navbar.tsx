import { Badge } from "./badge";
import { Icon } from "./icons";

export function Navbar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="dashboard-navbar">
      <div className="dashboard-brand">
        <button
          aria-label="Toggle sidebar"
          className="dashboard-mobile-toggle"
          onClick={onMenuClick}
          type="button"
        >
          ☰
        </button>
        <span className="dashboard-logo-mark" aria-hidden="true" />
        <span className="dashboard-wordmark">Sweem</span>
        <Badge>Beta</Badge>
      </div>

      <div className="dashboard-top-actions">
        <button className="dashboard-top-action" type="button">
          <Icon name="support" size={15} strokeWidth={2.65} />
          <span>Support</span>
        </button>
        <button className="dashboard-top-action" type="button">
          <Icon name="feedback" size={16} strokeWidth={2.55} />
          <span>Feedback</span>
        </button>
        <button aria-label="Open profile" className="dashboard-avatar" type="button">
          <Icon name="user" size={17} strokeWidth={2.1} />
        </button>
      </div>
    </header>
  );
}
