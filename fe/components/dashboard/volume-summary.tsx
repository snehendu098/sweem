const defaultRows: [string, string][] = [
  ["Last 7 Days", "$0"],
  ["Last 30 Days", "$0"],
  ["This Year", "$0"],
];

export function VolumeSummary({
  title = "Past volume",
  rows = defaultRows,
  note = "Volume is in US Dollar",
}: {
  title?: string;
  rows?: [string, string][];
  note?: string;
}) {
  return (
    <aside className="dashboard-volume-summary">
      <div className="dashboard-volume-title">{title}</div>
      <div className="dashboard-volume-list">
        {rows.map(([label, value]) => (
          <div className="dashboard-volume-row" key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-volume-note">{note}</div>
    </aside>
  );
}
