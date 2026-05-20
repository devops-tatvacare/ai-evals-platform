import { formatKpiValue } from '../chartFormat';
import type { ChartPayloadKpi } from '../types';

interface ChatKpiCardProps {
  kpi: ChartPayloadKpi['kpi'];
}

// Body-only: the showpiece stat — oversized brand number over a muted label.
// Card chrome (title, warning, actions) lives in ChatArtifactCard.
export function ChatKpiCard({ kpi }: ChatKpiCardProps) {
  return (
    <div className="py-1">
      <div className="bg-[image:var(--gradient-brand-mark)] bg-clip-text text-4xl font-bold leading-none tracking-tight tabular-nums text-transparent">
        {formatKpiValue(kpi.value ?? null, kpi.format)}
      </div>
      <div className="mt-2 text-xs font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
        {kpi.label}
      </div>
    </div>
  );
}
