export function MetricCard({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="card metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="icon-box" style={tone ? { color: tone } : undefined}>
        {icon}
      </div>
    </div>
  );
}
