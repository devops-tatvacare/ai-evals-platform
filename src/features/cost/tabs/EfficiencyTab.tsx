import { useEffect } from 'react';
import { Gauge } from 'lucide-react';
import { useCostStore } from '@/stores/costStore';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { formatInt, formatPercent, formatTokensCompact, formatUsd } from '../utils/format';
import type { EfficiencyBundle, EfficiencyGaugePoint, GroupedSpend } from '../types';

interface TabProps {
  active: boolean;
}

export function EfficiencyTab({ active }: TabProps) {
  const slice = useCostStore((s) => s.efficiency);
  const loadEfficiency = useCostStore((s) => s.loadEfficiency);
  const refresh = useCostStore((s) => s.refreshActive);
  const filtersKey = useCostStore((s) => s.filtersKey);

  useEffect(() => {
    if (active) void loadEfficiency();
  }, [active, loadEfficiency, filtersKey]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-6">
      <SliceStateBoundary
        slice={slice}
        onRetry={() => refresh('efficiency')}
        emptyIcon={Gauge}
        emptyTitle="No efficiency data"
        emptyDescription="Cache, error, and unpriced metrics need at least one LLM call in range."
        isEmpty={(data) =>
          data.cacheByPurpose.length === 0 &&
          data.errorByCode.length === 0 &&
          data.unpricedCalls.length === 0 &&
          data.reasoningByModel.length === 0 &&
          (data.cacheGauge.find((p) => p.label === 'cached_read')?.value ?? 0) === 0 &&
          (data.errorGauge.find((p) => p.label === 'errors')?.value ?? 0) === 0
        }
      >
        {(data) => <EfficiencyContent data={data} />}
      </SliceStateBoundary>
    </div>
  );
}

function EfficiencyContent({ data }: { data: EfficiencyBundle }) {
  const cacheHitRate = pickValue(data.cacheGauge, 'hit_rate');
  const cachedRead = pickValue(data.cacheGauge, 'cached_read');
  const errorRate = pickValue(data.errorGauge, 'error_rate');
  const errorCount = pickValue(data.errorGauge, 'errors');

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Cache hit rate" value={formatPercent(cacheHitRate)} />
        <StatCard label="Cached tokens" value={formatTokensCompact(cachedRead)} />
        <StatCard label="Error rate" value={formatPercent(errorRate)} tone={errorRate > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Error calls" value={formatInt(errorCount)} tone={errorCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="Cache reads by purpose"
          rows={data.cacheByPurpose}
          valueLabel="Cached tokens"
          formatValue={(v) => formatTokensCompact(v)}
        />
        <BreakdownTable
          title="Errors by code"
          rows={data.errorByCode}
          valueLabel="Calls"
          formatValue={(v) => formatInt(v)}
          fallbackKey="tokens"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="Unpriced calls"
          rows={data.unpricedCalls}
          valueLabel="Calls"
          formatValue={(v) => formatInt(v)}
          fallbackKey="tokens"
        />
        <BreakdownTable
          title="Reasoning tokens by model"
          rows={data.reasoningByModel}
          valueLabel="Tokens"
          formatValue={(v) => formatTokensCompact(v)}
        />
      </div>
    </>
  );
}

function pickValue(points: EfficiencyGaugePoint[], label: string): number {
  return points.find((p) => p.label === label)?.value ?? 0;
}

function StatCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'danger' | 'warning';
}) {
  const color =
    tone === 'danger'
      ? 'text-[var(--color-error)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--text-primary)]';
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  valueLabel,
  formatValue,
  fallbackKey,
}: {
  title: string;
  rows: GroupedSpend[];
  valueLabel: string;
  formatValue: (v: number) => string;
  fallbackKey?: 'tokens' | 'calls';
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">No data</p>
      </div>
    );
  }

  const asChartData = rows.map((r) => ({
    key: r.key,
    value: fallbackKey === 'tokens' ? r.tokens : fallbackKey === 'calls' ? r.calls : r.tokens,
  }));

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <ChartRenderer
        type="horizontal_bar"
        data={asChartData as unknown as Record<string, unknown>[]}
        xKey="value"
        yKey="key"
        legendPosition="none"
        height={Math.max(160, rows.length * 28)}
      />
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="py-2 text-left font-medium">Key</th>
            <th className="py-2 text-right font-medium">{valueLabel}</th>
            <th className="py-2 text-right font-medium">Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="py-2 pr-2 text-[var(--text-primary)]">{r.key}</td>
              <td className="py-2 pr-2 text-right tabular-nums text-[var(--text-secondary)]">
                {formatValue(
                  fallbackKey === 'calls' ? r.calls : fallbackKey === 'tokens' ? r.tokens : r.tokens,
                )}
              </td>
              <td className="py-2 text-right tabular-nums text-[var(--text-primary)]">
                {formatUsd(r.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
