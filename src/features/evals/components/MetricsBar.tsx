import { Sparkles } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { cn } from '@/utils/cn';
import type { MetricResult } from '../metrics';

interface MetricsBarProps {
  metrics: MetricResult[] | null;
  /** When true, shows the AI/Human source toggle */
  hasHumanReview?: boolean;
  /** Current metrics source */
  metricsSource?: 'ai' | 'human';
  /** Callback when source toggles */
  onMetricsSourceChange?: (source: 'ai' | 'human') => void;
}

export function MetricsBar({
  metrics,
  hasHumanReview,
  metricsSource = 'ai',
  onMetricsSourceChange,
}: MetricsBarProps) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
          <Sparkles className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-[12px] text-[var(--text-muted)]">
            Run AI Evaluation to see metrics
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {/* Source toggle — only when human review exists */}
      {hasHumanReview && onMetricsSourceChange && (
        <div className="flex items-center">
          <div className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-0.5">
            <button
              type="button"
              onClick={() => onMetricsSourceChange('ai')}
              className={cn(
                'px-3 py-1 text-[12px] font-medium rounded-md transition-all',
                metricsSource === 'ai'
                  ? 'bg-[var(--bg-brand)] text-[var(--text-on-brand)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              AI Computed
            </button>
            <button
              type="button"
              onClick={() => onMetricsSourceChange('human')}
              className={cn(
                'px-3 py-1 text-[12px] font-medium rounded-md transition-all',
                metricsSource === 'human'
                  ? 'bg-[var(--bg-brand)] text-[var(--text-on-brand)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              Human Reviewed
            </button>
          </div>
        </div>
      )}

      {/* Metrics grid */}
      <div className="flex items-center gap-3">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`,
            minWidth: `${metrics.length * 120}px`,
          }}
        >
          {metrics.map(metric => (
            <MetricCard key={metric.id} metric={metric} compact />
          ))}
        </div>
      </div>
    </div>
  );
}
