import { cn } from '@/utils';
import type { EvaluatorThresholds } from '@/types';

interface NumberDisplayProps {
  value: unknown;
  thresholds?: EvaluatorThresholds;
  className?: string;
}

export function NumberDisplay({ value, thresholds, className }: NumberDisplayProps) {
  if (value === null || value === undefined) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        —
      </div>
    );
  }

  const numValue = typeof value === 'number' ? value : parseFloat(String(value));

  if (isNaN(numValue)) {
    return (
      <div className={cn('text-sm text-[var(--text-muted)]', className)}>
        Invalid number
      </div>
    );
  }

  // Determine if this is a percentage (0-100 range)
  const isPercentage = numValue >= 0 && numValue <= 100;
  const displayValue = isPercentage ? `${numValue.toFixed(1)}%` : numValue.toFixed(2);

  // Calculate color based on thresholds
  let colorClass = 'text-[var(--text-primary)]';
  let barColorClass = 'bg-[var(--interactive-primary)]';
  let barPercentage = isPercentage ? numValue : 0;

  if (thresholds) {
    if (numValue >= thresholds.green) {
      colorClass = 'text-[var(--color-success)]';
      barColorClass = 'bg-[var(--color-success)]';
    } else if (numValue >= thresholds.yellow) {
      colorClass = 'text-[var(--color-warning)]';
      barColorClass = 'bg-[var(--color-warning)]';
    } else {
      colorClass = 'text-[var(--color-error)]';
      barColorClass = 'bg-[var(--color-error)]';
    }

    // Calculate percentage for bar
    barPercentage = (numValue / thresholds.green) * 100;
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn('text-2xl font-bold', colorClass)}>
        {displayValue}
      </div>
      {(thresholds || isPercentage) && (
        <div className="h-2 w-full bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColorClass)}
            style={{ width: `${Math.min(Math.max(barPercentage, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
