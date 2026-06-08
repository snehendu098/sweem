import {
  DashboardPageShell,
  DataTable,
} from "@/components/dashboard/dashboard-screen";

const columns = [
  { label: "Name" },
  { label: "Secret key" },
  { label: "Created on" },
  { label: "More" },
];

export default function ApiKeysPage() {
  return (
    <DashboardPageShell
      title="Personal access tokens"
      subtitle={
        <>
          Tokens you have generated to access <span className="dashboard-link-text">Sweem API.</span>
        </>
      }
      actions={[{ label: "Generate key", icon: "plus" }]}
    >
      <DataTable
        columns={columns}
        empty={
          <div className="dashboard-key-empty">
            <p>No keys generated</p>
            <span>Generate your first personal access token</span>
            <button className="dashboard-screen-action dashboard-screen-action-primary" type="button">
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              Generate key
            </button>
          </div>
        }
      />
    </DashboardPageShell>
  );
}
