import {
  DashboardPageShell,
  DataTable,
  PlainEmpty,
} from "@/components/dashboard/dashboard-screen";

const columns = [
  { label: "Name" },
  { label: "Email" },
  { label: "Payments" },
  { label: "Total spent" },
  { label: "Last payment" },
  { label: "Created" },
  { label: "More" },
];

export default function CustomersPage() {
  return (
    <DashboardPageShell
      title="Customers"
      actions={[
        { label: "Import Customers", icon: "upload" },
        { label: "Add Customer", kind: "primary", icon: "plus" },
      ]}
    >
      <DataTable
        columns={columns}
        empty={<PlainEmpty>No results found</PlainEmpty>}
      />
    </DashboardPageShell>
  );
}
