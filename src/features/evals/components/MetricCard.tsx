import { cn } from '@/utils';
import { getRatingColors, type MetricResult } from '../metrics';

interface MetricCardProps {
  metric: MetricResult;
  compact?: boolean;
}

export function MetricCard({ metric, compact = false }: MetricCardProps) {
  const colors = getRatingColors(metric.rating);

  if (compact) {
    return (
      <div className={cn('rounded-lg border border-[var(--border-subtle)] px-3 py-2', colors.bg)}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            {metric.label}
          </span>
          <span className={cn('text-[13px] font-semibold', colors.text)}>
            {metric.displayValue}
          </span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
          <div
            className={cn('h-full rounded-full transition-all', colors.bar)}
            style={{ width: `${Math.min(metric.percentage, 100)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-[var(--border-subtle)] p-3', colors.bg)}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {metric.label}
        </span>
        <span className={cn('text-[15px] font-bold', colors.text)}>
          {metric.displayValue}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
        <div
          className={cn('h-full rounded-full transition-all duration-300', colors.bar)}
          style={{ width: `${Math.min(metric.percentage, 100)}%` }}
        />
      </div>
      <div className="mt-1.5 text-center">
        <span className={cn('text-[10px] font-medium capitalize', colors.text)}>
          {metric.rating}
        </span>
      </div>
    </div>
  );
}
