import { cn } from '@/utils/cn';
import type { ChartSummaryField } from '../types';

interface ChatSummaryCardProps {
  summary: { fields: ChartSummaryField[] };
  title?: string;
  warning?: string | null;
}

const NUMBER_FMT = new Intl.NumberFormat('en-US');
const CURRENCY_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatSummaryValue(value: unknown, semanticType?: string | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (semanticType === 'percent') return `${value.toFixed(1)}%`;
    if (semanticType === 'currency') return CURRENCY_FMT.format(value);
    return NUMBER_FMT.format(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ChatSummaryCard({ summary, title, warning }: ChatSummaryCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4',
      )}
    >
      {title ? (
        <div className="mb-3 text-xs font-medium text-[var(--text-muted)]">{title}</div>
      ) : null}
      {warning ? (
        <div className="mb-3 rounded-sm border border-[var(--border-warning)] bg-[var(--surface-warning)] px-2 py-1 text-[11px] text-[var(--color-warning-dark)]">
          {warning}
        </div>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {summary.fields.map((field) => (
          <div key={field.name} className="contents">
            <dt className="text-xs text-[var(--text-muted)]">{field.label}</dt>
            <dd className="break-all text-sm tabular-nums text-[var(--text-primary)]">
              {formatSummaryValue(field.value, field.semantic_type ?? undefined)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
