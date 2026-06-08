import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";
import { RecentPaymentsTable } from "@/components/dashboard/recent-payments-table";

export default function DashboardPage() {
  return (
    <section className="dashboard-content">
      <h1 className="dashboard-title">Today</h1>

      <div className="dashboard-card-grid">
        <DashboardCard
          icon="link"
          title="Create a payment link"
          description="Receive crypto payments for anything"
          primaryAction="Create"
          secondaryAction="View demo"
        />
        <DashboardCard
          icon="invoice"
          title="Create an invoice"
          description="Create and send crypto invoices to your customers or clients"
          primaryAction="Create"
          secondaryAction="View demo"
        />
        <DashboardCard
          icon="code"
          title="Integrate payments"
          description="Powered your app with crypto payments through a powerful API"
          secondaryAction="View docs"
        />
      </div>

      <AnalyticsSection />
      <RecentPaymentsTable />
    </section>
  );
}
