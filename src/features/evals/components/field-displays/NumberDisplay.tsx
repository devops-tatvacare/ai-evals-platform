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
  let barColorClass = 'bg-blue-500';
  let barPercentage = isPercentage ? numValue : 0;

  if (thresholds) {
    if (numValue >= thresholds.green) {
      colorClass = 'text-emerald-600 dark:text-emerald-400';
      barColorClass = 'bg-emerald-500';
    } else if (numValue >= thresholds.yellow) {
      colorClass = 'text-amber-600 dark:text-amber-400';
      barColorClass = 'bg-amber-500';
    } else {
      colorClass = 'text-red-600 dark:text-red-400';
      barColorClass = 'bg-red-500';
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
