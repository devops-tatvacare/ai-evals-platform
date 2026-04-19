import { useEffect } from 'react';
import { BarChart3 } from 'lucide-react';
import { useCostStore } from '@/stores/costStore';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { CostKpiRow } from '../components/CostKpiRow';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { formatUsdCompact } from '../utils/format';

interface TabProps {
  active: boolean;
}

export function OverviewTab({ active }: TabProps) {
  const slice = useCostStore((s) => s.overview);
  const loadOverview = useCostStore((s) => s.loadOverview);
  const refresh = useCostStore((s) => s.refreshActive);
  const filtersKey = useCostStore((s) => s.filtersKey);

  useEffect(() => {
    if (active) void loadOverview();
  }, [active, loadOverview, filtersKey]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-6">
      <SliceStateBoundary
        slice={slice}
        onRetry={() => refresh('overview')}
        emptyIcon={BarChart3}
        emptyTitle="No usage yet"
        emptyDescription="No LLM calls were recorded for the selected range."
        isEmpty={(data) => data.kpis.totalCalls === 0}
      >
        {(data) => (
          <>
            <CostKpiRow kpis={data.kpis} />

            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Spend over time</h2>
                <span className="text-[11px] text-[var(--text-muted)]">daily</span>
              </div>
              <ChartRenderer
                type="area"
                data={data.timeSeries as unknown as Record<string, unknown>[]}
                xKey="day"
                yKey="costUsd"
                legendPosition="none"
                height={260}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <BreakdownCard title="Spend by app" rows={data.spendByApp} />
              <BreakdownCard title="Spend by purpose" rows={data.spendByPurpose} />
            </div>
          </>
        )}
      </SliceStateBoundary>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; costUsd: number; tokens: number; calls: number }[];
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">No spend recorded</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between text-[13px]">
            <span className="truncate text-[var(--text-secondary)]">{row.key}</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">
              {formatUsdCompact(row.costUsd)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
