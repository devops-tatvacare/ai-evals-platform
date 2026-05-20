import { cn } from '@/utils/cn';
import { formatSummaryValue } from '../chartFormat';
import type { ChartSummaryField } from '../types';

interface ChatSummaryCardProps {
  summary: { fields: ChartSummaryField[] };
}

// Body-only: hairline-separated field rows, measures emphasized + tabular.
export function ChatSummaryCard({ summary }: ChatSummaryCardProps) {
  return (
    <dl className="flex flex-col">
      {summary.fields.map((field, i) => (
        <div
          key={field.name}
          className={cn(
            'flex items-baseline justify-between gap-4 py-2',
            i > 0 && 'border-t border-[var(--border-subtle)]',
          )}
        >
          <dt className="text-xs text-[var(--text-muted)]">{field.label}</dt>
          <dd className="break-all text-right text-sm font-medium tabular-nums text-[var(--text-primary)]">
            {formatSummaryValue(field.value, field.semantic_type ?? undefined)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
