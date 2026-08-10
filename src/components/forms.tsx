export function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

export function Field({
  label,
  htmlFor,
  required = false,
  children
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="required-marker" aria-label="required"> *</span> : null}
      </label>
      {children}
    </div>
  );
}
