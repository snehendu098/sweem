import { ChartToolbar } from "./chart-toolbar";
import { MetricsOverview, type Metric } from "./metrics-overview";
import { VolumeSummary } from "./volume-summary";
import { StreamedChart } from "./sweem/streamed-chart";

export function AnalyticsSection({
  metrics,
  volumeTitle,
  volumeRows,
  volumeNote,
}: {
  metrics?: Metric[];
  volumeTitle?: string;
  volumeRows?: [string, string][];
  volumeNote?: string;
} = {}) {
  return (
    <section className="dashboard-analytics" aria-labelledby="analytics-heading">
      <h2 id="analytics-heading" className="sr-only">
        Analytics
      </h2>
      <div className="dashboard-analytics-main">
        <div className="dashboard-analytics-head">
          <MetricsOverview metrics={metrics} />
          <ChartToolbar />
        </div>
        <StreamedChart />
      </div>
      <VolumeSummary title={volumeTitle} rows={volumeRows} note={volumeNote} />
    </section>
  );
}
