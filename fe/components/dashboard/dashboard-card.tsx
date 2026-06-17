import { Button } from "./button";
import { Icon, type IconName } from "./icons";

type DashboardCardIcon = Extract<IconName, "code" | "link" | "invoice">;

export function DashboardCard({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
}: {
  icon: DashboardCardIcon;
  title: string;
  description: string;
  primaryAction?: string;
  secondaryAction: string;
}) {
  return (
    <article className="dashboard-action-card dashboard-dot-pattern">
      <span className="dashboard-action-icon">
        <Icon name={icon} size={22} strokeWidth={2.8} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="dashboard-card-actions">
        {primaryAction ? (
          <Button icon="plus" variant="primary">
            {primaryAction}
          </Button>
        ) : null}
        <Button variant={primaryAction ? "ghost" : "primary"}>
          {secondaryAction}
        </Button>
      </div>
    </article>
  );
}
