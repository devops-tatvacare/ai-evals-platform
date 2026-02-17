import { cn } from '@/utils';
import type { EvaluatorDefinition, EvalRun } from '@/types';

interface EvaluatorMetricsProps {
  evaluators: EvaluatorDefinition[];
  latestRuns?: Record<string, EvalRun>;
}

export function EvaluatorMetrics({ evaluators, latestRuns = {} }: EvaluatorMetricsProps) {
  // Filter evaluators that should show in header
  const headerEvaluators = evaluators.filter(e => e.showInHeader);

  if (headerEvaluators.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex items-center gap-3 flex-wrap">
      {headerEvaluators.map(evaluator => {
        const mainMetricField = evaluator.outputSchema.find(f => f.isMainMetric);
        if (!mainMetricField) return null;

        const latestRun = latestRuns[evaluator.id];
        if (!latestRun || latestRun.status !== 'completed') return null;

        const runOutput = (latestRun.result as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined;
        const value = runOutput?.[mainMetricField.key];
        if (value === undefined) return null;
        
        const displayValue = formatValue(value, mainMetricField.type);
        
        const getColors = () => {
          if (mainMetricField.type === 'number' && typeof value === 'number') {
            const normalized = value > 1 ? value / 10 : value;
            if (normalized >= 0.9) return { bg: 'bg-[var(--color-success)]/10', text: 'text-[var(--color-success)]', bar: 'bg-[var(--color-success)]' };
            if (normalized >= 0.7) return { bg: 'bg-[var(--color-success)]/10', text: 'text-[var(--color-success)]', bar: 'bg-[var(--color-success)]' };
            if (normalized >= 0.5) return { bg: 'bg-[var(--color-warning)]/10', text: 'text-[var(--color-warning)]', bar: 'bg-[var(--color-warning)]' };
            return { bg: 'bg-[var(--color-error)]/10', text: 'text-[var(--color-error)]', bar: 'bg-[var(--color-error)]' };
          }
          return { bg: 'bg-[var(--color-info)]/10', text: 'text-[var(--color-info)]', bar: 'bg-[var(--color-info)]' };
        };
        
        const colors = getColors();
        
        const percentage = mainMetricField.type === 'number' && typeof value === 'number'
          ? (value > 1 ? value * 10 : value * 100)
          : 100;
        
        return (
          <div 
            key={evaluator.id}
            className={cn('rounded-lg border border-[var(--border-subtle)] px-3 py-2 min-w-[140px]', colors.bg)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate">
                {evaluator.name}
              </span>
              <span className={cn('text-[13px] font-semibold whitespace-nowrap', colors.text)}>
                {displayValue}
              </span>
            </div>
            {mainMetricField.type === 'number' && (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div
                  className={cn('h-full rounded-full transition-all', colors.bar)}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return '-';
  
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value.toFixed(2) : String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'array':
      return Array.isArray(value) ? value.length.toString() : String(value);
    default:
      // Truncate long strings
      const str = String(value);
      return str.length > 20 ? str.substring(0, 20) + '...' : str;
  }
}
