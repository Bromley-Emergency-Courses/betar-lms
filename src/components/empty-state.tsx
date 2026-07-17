export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
