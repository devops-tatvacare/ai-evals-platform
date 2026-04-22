import { cn } from '@/utils/cn';
import type { ChartPayloadKpi, KpiFormat } from '../types';

interface ChatKpiCardProps {
  kpi: ChartPayloadKpi['kpi'];
  title?: string;
  warning?: string | null;
}

const INTEGER_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DECIMAL_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const CURRENCY_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatKpiValue(value: number | string | null, format: KpiFormat): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'integer':
      return INTEGER_FMT.format(value);
    case 'decimal':
      return DECIMAL_FMT.format(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'currency':
      return CURRENCY_FMT.format(value);
    case 'duration_ms':
      return `${INTEGER_FMT.format(Math.round(value))} ms`;
    default:
      return String(value);
  }
}

export function ChatKpiCard({ kpi, title, warning }: ChatKpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4',
      )}
    >
      {title ? (
        <div className="mb-1 text-xs text-[var(--text-muted)]">{title}</div>
      ) : null}
      {warning ? (
        <div className="mb-2 rounded-sm border border-[var(--border-warning)] bg-[var(--surface-warning)] px-2 py-1 text-[11px] text-[var(--color-warning-dark)]">
          {warning}
        </div>
      ) : null}
      <div className="text-3xl font-semibold tabular-nums text-[var(--text-primary)]">
        {formatKpiValue(kpi.value ?? null, kpi.format)}
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{kpi.label}</div>
    </div>
  );
}
