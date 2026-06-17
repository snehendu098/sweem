import { ChartToolbar } from "./chart-toolbar";
import { MetricsOverview } from "./metrics-overview";
import { VolumeSummary } from "./volume-summary";

function EmptyStateChart() {
  return (
    <div className="dashboard-chart" aria-label="Daily gross volume is zero">
      <span className="dashboard-chart-axis">00:00</span>
      <span className="dashboard-chart-axis dashboard-chart-axis-end">23:59</span>
      <span className="dashboard-chart-line" />
      <span className="dashboard-chart-guide" />
      <span className="dashboard-chart-marker" />
      <div className="dashboard-tooltip">
        <div>
          Time: <strong>15:00</strong>
        </div>
        <div>
          Volume: <strong>0</strong>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsSection() {
  return (
    <section className="dashboard-analytics" aria-labelledby="analytics-heading">
      <h2 id="analytics-heading" className="sr-only">
        Analytics
      </h2>
      <div className="dashboard-analytics-main">
        <div className="dashboard-analytics-head">
          <MetricsOverview />
          <ChartToolbar />
        </div>
        <EmptyStateChart />
      </div>
      <VolumeSummary />
    </section>
  );
}
