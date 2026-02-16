export interface ReviewSection {
  label: string;
  items: { key: string; value: string }[];
}

interface ReviewStepProps {
  sections: ReviewSection[];
}

export function ReviewStep({ sections }: ReviewStepProps) {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div
          key={section.label}
          className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden"
        >
          <div className="px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
            <h3 className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {section.label}
            </h3>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {section.items.map((item) => (
              <div key={item.key} className="flex items-start justify-between px-4 py-2.5 gap-4">
                <span className="text-[13px] text-[var(--text-secondary)] shrink-0">{item.key}</span>
                <span className="text-[13px] text-[var(--text-primary)] font-medium text-right break-words min-w-0">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
