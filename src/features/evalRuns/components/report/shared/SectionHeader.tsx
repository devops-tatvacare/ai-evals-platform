interface Props {
  title: string;
  description?: string;
}

export default function SectionHeader({ title, description }: Props) {
  return (
    <div className="mb-6 pb-3 border-b border-[var(--border-subtle)]">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-primary)]">
        {title}
      </h2>
      {description && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
      )}
    </div>
  );
}
