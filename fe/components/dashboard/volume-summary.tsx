const volumeRows = [
  ["Last 7 Days", "$0"],
  ["Last 30 Days", "$0"],
  ["This Year", "$0"],
];

export function VolumeSummary() {
  return (
    <aside className="dashboard-volume-summary">
      <div className="dashboard-volume-title">Past volume</div>
      <div className="dashboard-volume-list">
        {volumeRows.map(([label, value]) => (
          <div className="dashboard-volume-row" key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-volume-note">Volume is in US Dollar</div>
    </aside>
  );
}
