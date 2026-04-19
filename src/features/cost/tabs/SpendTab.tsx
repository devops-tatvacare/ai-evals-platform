import { useEffect } from 'react';
import { PieChart } from 'lucide-react';
import { useCostStore } from '@/stores/costStore';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { SliceStateBoundary } from '../components/SliceStateBoundary';
import { formatInt, formatTokensCompact, formatUsd, formatUsdCompact, truncateId } from '../utils/format';
import type { GroupedSpend } from '../types';

interface TabProps {
  active: boolean;
}

export function SpendTab({ active }: TabProps) {
  const slice = useCostStore((s) => s.spend);
  const loadSpend = useCostStore((s) => s.loadSpend);
  const refresh = useCostStore((s) => s.refreshActive);
  const filtersKey = useCostStore((s) => s.filtersKey);

  useEffect(() => {
    if (active) void loadSpend();
  }, [active, loadSpend, filtersKey]);

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4 pb-6">
      <SliceStateBoundary
        slice={slice}
        onRetry={() => refresh('spend')}
        emptyIcon={PieChart}
        emptyTitle="No spend"
        emptyDescription="No LLM spend was recorded for the selected range."
        isEmpty={(data) =>
          data.byApp.length === 0 &&
          data.byPurpose.length === 0 &&
          data.topModels.length === 0 &&
          data.topUsers.length === 0
        }
      >
        {(data) => (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <HorizontalBarCard title="Spend by app" rows={data.byApp} />
              <HorizontalBarCard title="Spend by purpose" rows={data.byPurpose} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <TopTable
                title="Top models"
                rows={data.topModels}
                rowLabel={(row) => row.key}
              />
              <TopTable
                title="Top users"
                rows={data.topUsers}
                rowLabel={(row) => truncateId(row.key, 8)}
              />
            </div>
          </>
        )}
      </SliceStateBoundary>
    </div>
  );
}

function HorizontalBarCard({ title, rows }: { title: string; rows: GroupedSpend[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">No data</p>
      ) : (
        <ChartRenderer
          type="horizontal_bar"
          data={rows.map((r) => ({ key: r.key, cost: Number(r.costUsd) })) as unknown as Record<string, unknown>[]}
          xKey="cost"
          yKey="key"
          legendPosition="none"
          height={Math.max(160, rows.length * 28)}
        />
      )}
    </div>
  );
}

function TopTable({
  title,
  rows,
  rowLabel,
}: {
  title: string;
  rows: GroupedSpend[];
  rowLabel: (row: GroupedSpend) => string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--text-muted)]">No data</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="py-2 text-left font-medium">Key</th>
              <th className="py-2 text-right font-medium">Spend</th>
              <th className="py-2 text-right font-medium">Tokens</th>
              <th className="py-2 text-right font-medium">Calls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <td className="py-2 pr-2 text-[var(--text-primary)]" title={row.key}>
                  {rowLabel(row)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-[var(--text-primary)]">
                  {formatUsd(row.costUsd)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatTokensCompact(row.tokens)}
                </td>
                <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatInt(row.calls)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Total across table: {formatUsdCompact(rows.reduce((sum, r) => sum + r.costUsd, 0))}
      </p>
    </div>
  );
}
