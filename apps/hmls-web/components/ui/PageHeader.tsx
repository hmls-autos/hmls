export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-display font-semibold tracking-tight text-text mb-1">
        {title}
      </h1>
      <p className="text-sm text-text-secondary">{subtitle}</p>
    </div>
  );
}
