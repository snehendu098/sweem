import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";

const groups = [
  {
    title: "General",
    items: [
      { title: "Account", description: "Basic info like user details and login details", color: "#8c98ad", icon: "user" },
      { title: "Business", description: "Update your business details", color: "#5872f4", icon: "store" },
      { title: "Branding", description: "Customise branding like logos & colours", color: "#a15ff0", icon: "brush" },
    ],
  },
  {
    title: "Payments",
    items: [
      { title: "Payment methods", description: "Manage payment receiving address", color: "#28a3b6", icon: "card" },
      { title: "Invoices", description: "Manage due dates, memos, footers, etc", color: "#ef45b8", icon: "invoice" },
      { title: "Promocodes", description: "Manage promocodes based on your requirements", color: "#37a15d", icon: "dollar" },
      { title: "Taxes", description: "Manage taxes based on your requirements", color: "#f04450", icon: "dollar" },
    ],
  },
  {
    title: "Team",
    items: [
      { title: "Team", description: "Manage your team members", color: "#8ec70a", icon: "team" },
    ],
  },
];

function SettingsIcon({ icon }: { icon: string }) {
  if (icon === "brush") {
    return <path d="M16.5 4.5 19.5 7.5 9 18H6v-3L16.5 4.5Z" />;
  }
  if (icon === "store") {
    return <path d="M5 10h14l-1-5H6l-1 5Zm2 0v8h10v-8M9 18v-4h6v4" />;
  }
  if (icon === "card") {
    return <path d="M4 7h16v10H4V7Zm0 4h16M8 14h3" />;
  }
  if (icon === "invoice") {
    return <path d="M7 5h10v14l-2-1-2 1-2-1-2 1-2-1V5Zm3 4h4m-4 4h4" />;
  }
  if (icon === "dollar") {
    return <path d="M12 5v14m4-10c-1.5-2-8-2-8 1 0 4 8 1 8 5 0 3-6.5 3-8 1" />;
  }
  if (icon === "team") {
    return <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-1a2.5 2.5 0 1 0 0-5M4 18c.4-3 2.2-4.5 5-4.5s4.6 1.5 5 4.5m1.5-4c2 .3 3.2 1.7 3.5 4" />;
  }
  return <path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7c.4-3.2 2.1-4.8 5-4.8s4.6 1.6 5 4.8" />;
}

export default function SettingsPage() {
  return (
    <DashboardPageShell title="Settings">
      <div className="dashboard-settings">
        {groups.map((group) => (
          <section className="dashboard-settings-group" key={group.title}>
            <h2>{group.title}</h2>
            <div className="dashboard-settings-grid">
              {group.items.map((item) => (
                <button className="dashboard-settings-card" key={item.title} type="button">
                  <span className="dashboard-settings-icon" style={{ background: item.color }}>
                    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <SettingsIcon icon={item.icon} />
                    </svg>
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DashboardPageShell>
  );
}
