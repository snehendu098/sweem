const metrics = [
  { label: "Gross Volume", value: "$0" },
  { label: "No. of Payments", value: "0" },
];

export function MetricsOverview() {
  return (
    <div className="dashboard-metrics">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <div className="dashboard-metric-label">{metric.label}</div>
          <div className="dashboard-metric-value">{metric.value}</div>
        </div>
      ))}
    </div>
  );
}
