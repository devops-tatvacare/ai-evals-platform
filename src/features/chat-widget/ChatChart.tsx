import { useMemo, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import type { ChartData } from './types';

/** Compute a sensible chart height based on type and data volume. */
function resolveChartHeight(type: ChartData['spec']['type'], dataCount: number): number {
  switch (type) {
    case 'pie':
      return 260;
    case 'horizontal_bar':
      return Math.max(200, Math.min(dataCount * 28, 400));
    default:
      return 200;
  }
}

/**
 * For pie/horizontal_bar with many items, group tail entries into "Other"
 * so the chart stays readable in the narrow widget.
 */
const MAX_SLICES = 8;

function consolidateData(
  data: Record<string, unknown>[],
  type: ChartData['spec']['type'],
  xKey: string,
  yKey: string | undefined,
): Record<string, unknown>[] {
  if (type !== 'pie' || data.length <= MAX_SLICES) return data;

  const valueKey = yKey || 'value';
  const sorted = [...data].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0));
  const top = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1);

  if (rest.length === 0) return top;

  const otherValue = rest.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  return [...top, { [xKey]: `Other (${rest.length})`, [valueKey]: otherValue }];
}

interface ChatChartProps {
  chart: ChartData;
  appId: string;
}

export function ChatChart({ chart, appId }: ChatChartProps) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await analyticsLibraryApi.saveChart({
        appId,
        title: chart.spec.title,
        sqlQuery: chart.sqlQuery,
        chartConfig: {
          type: chart.spec.type,
          xKey: chart.spec.xKey,
          yKey: chart.spec.yKey,
          seriesKeys: chart.spec.seriesKeys,
          xLabel: chart.spec.xLabel,
          yLabel: chart.spec.yLabel,
        },
        sourceQuestion: chart.sourceQuestion,
      });
      setSaved(true);
      notificationService.success('Chart added to library');
    } catch {
      notificationService.error('Failed to save chart');
    } finally {
      setSaving(false);
    }
  };

  const displayData = useMemo(
    () => consolidateData(
      chart.data as Record<string, unknown>[],
      chart.spec.type,
      chart.spec.xKey,
      chart.spec.yKey,
    ),
    [chart.data, chart.spec.type, chart.spec.xKey, chart.spec.yKey],
  );

  const height = resolveChartHeight(chart.spec.type, displayData.length);

  return (
    <div className="mt-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[var(--text-primary)] truncate mr-2">{chart.spec.title}</span>
        <button
          onClick={handleSave}
          disabled={saved || saving}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors shrink-0',
            saved
              ? 'bg-[var(--color-verdict-pass)]/10 text-[var(--color-verdict-pass)]'
              : 'bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-primary)] hover:text-white',
          )}
        >
          {saved ? <Check className="h-2.5 w-2.5" /> : <Plus className="h-2.5 w-2.5" />}
          {saved ? 'Saved' : 'Add to library'}
        </button>
      </div>
      <ChartRenderer
        type={chart.spec.type}
        data={displayData}
        xKey={chart.spec.xKey}
        yKey={chart.spec.yKey}
        seriesKeys={chart.spec.seriesKeys}
        xLabel={chart.spec.xLabel}
        yLabel={chart.spec.yLabel}
        height={height}
        compact
      />
    </div>
  );
}
