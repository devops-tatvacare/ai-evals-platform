import { Sparkles } from 'lucide-react';
import { MetricCard } from './MetricCard';
import type { ListingMetrics } from '../metrics';

interface MetricsBarProps {
  metrics: ListingMetrics | null;
}

export function MetricsBar({ metrics }: MetricsBarProps) {
  if (!metrics) {
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
    <div className="mt-3 flex items-center gap-3">
      <div className="grid grid-cols-3 gap-2" style={{ minWidth: '360px' }}>
        <MetricCard metric={metrics.match} compact />
        <MetricCard metric={metrics.wer} compact />
        <MetricCard metric={metrics.cer} compact />
      </div>
    </div>
  );
}
