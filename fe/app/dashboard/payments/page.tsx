import {
  CheckboxFilter,
  DashboardPageShell,
  DataTable,
  EmptyIllustration,
  SearchField,
} from "@/components/dashboard/dashboard-screen";

const columns = [
  { label: "Date" },
  { label: "Amount" },
  { label: "Status" },
  { label: "Title" },
  { label: "Customer", icon: "settings" as const },
  { label: "Method" },
  { label: "Compliance" },
  { label: "Action" },
];

export default function PaymentsPage() {
  return (
    <DashboardPageShell
      title="Payments"
      actions={[
        { label: "Export", icon: "upload" },
        { label: "Reprocess payments", kind: "primary" },
      ]}
    >
      <div className="dashboard-list-toolbar">
        <SearchField placeholder="Search by checkout session ID" />
        <div className="dashboard-list-filters">
          <CheckboxFilter label="Show flagged sessions" />
          <CheckboxFilter label="Show expired sessions" />
          <button className="dashboard-refresh-button" type="button">
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 12a8 8 0 1 1-2.35-5.65M20 4v6h-6"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>
      <DataTable
        shaded
        columns={columns}
        empty={
          <EmptyIllustration
            title="No payment link created"
            description="Receive payment by sharing a link of a payment page with your customers."
          />
        }
      />
    </DashboardPageShell>
  );
}
