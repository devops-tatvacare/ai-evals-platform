export interface ReviewBadge {
  label: string;
  value: string;
}

export interface ReviewSummary {
  name: string;
  description?: string;
  badges: ReviewBadge[];
}

export interface ReviewSection {
  label: string;
  items: { key: string; value: string }[];
}

interface ReviewStepProps {
  summary: ReviewSummary;
  sections: ReviewSection[];
}

export function ReviewStep({ summary, sections }: ReviewStepProps) {
  return (
    <div className="space-y-4">
      {/* Zone 1 — Summary Banner */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
          {summary.name}
        </h3>
        {summary.description && (
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)] line-clamp-2">
            {summary.description}
          </p>
        )}
        {summary.badges.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {summary.badges.map((badge) => (
              <span
                key={badge.label}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
              >
                <span className="text-[var(--text-muted)]">{badge.label}:</span>
                <span className="font-medium text-[var(--text-primary)]">{badge.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Zone 2 — Grouped Details */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
        {sections.map((section, idx) => (
          <div key={section.label}>
            {idx > 0 && (
              <div className="mx-4 border-t border-dashed border-[var(--border-subtle)]" />
            )}
            <div className="px-4 pt-3 pb-1">
              <h4 className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                {section.label}
              </h4>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <div key={item.key} className="flex items-start justify-between py-1.5 gap-4">
                    <span className="text-[13px] text-[var(--text-secondary)] shrink-0">{item.key}</span>
                    <span className="text-[13px] text-[var(--text-primary)] font-medium text-right break-words min-w-0">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
