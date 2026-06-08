import {
  DashboardPageShell,
  DataTable,
  PlainEmpty,
  StatTabs,
} from "@/components/dashboard/dashboard-screen";

const columns = [
  { label: "Date" },
  { label: "Amount" },
  { label: "Invoice number" },
  { label: "Customer", icon: "settings" as const },
  { label: "Due" },
  { label: "Status" },
  { label: "More" },
];

export default function InvoicesPage() {
  return (
    <DashboardPageShell
      title="Invoices"
      actions={[{ label: "Create invoice", kind: "primary", icon: "plus" }]}
    >
      <StatTabs
        stats={[
          { label: "All invoices", value: "0", active: true },
          { label: "Draft", value: "0" },
          { label: "Overdue", value: "0" },
          { label: "Outstanding", value: "0" },
          { label: "Paid", value: "0" },
        ]}
      />
      <DataTable
        columns={columns}
        empty={<PlainEmpty>No results found</PlainEmpty>}
      />
    </DashboardPageShell>
  );
}
