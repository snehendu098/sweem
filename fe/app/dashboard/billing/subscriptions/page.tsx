import {
  DashboardPageShell,
  DataTable,
  PlainEmpty,
  StatTabs,
} from "@/components/dashboard/dashboard-screen";

const columns = [
  { label: "Customer", icon: "settings" as const },
  { label: "Product" },
  { label: "Amount" },
  { label: "Status" },
  { label: "Start date" },
  { label: "Method" },
  { label: "More" },
];

export default function SubscriptionsPage() {
  return (
    <DashboardPageShell title="Subscriptions">
      <StatTabs
        stats={[
          { label: "All subscriptions", value: "0", active: true },
          { label: "Active", value: "0" },
          { label: "Pending", value: "0" },
          { label: "Past due", value: "0" },
          { label: "Unpaid", value: "0" },
          { label: "Cancelled", value: "0" },
        ]}
      />
      <DataTable
        columns={columns}
        empty={<PlainEmpty>No results found</PlainEmpty>}
      />
    </DashboardPageShell>
  );
}
