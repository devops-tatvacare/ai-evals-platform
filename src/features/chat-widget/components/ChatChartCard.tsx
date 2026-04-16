import { useMemo, useState } from 'react';
import { Check, Copy, Save } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { analyticsChartForApp } from '@/config/routes';
import type { ChartPart, SaveToastPart } from '../types';

const TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  horizontal_bar: 'H. Bar',
  stacked_bar: 'Stacked',
  grouped_bar: 'Grouped',
  line: 'Line',
  area: 'Area',
  stacked_area: 'Stacked Area',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  radar: 'Radar',
  funnel: 'Funnel',
  treemap: 'Treemap',
  radial_bar: 'Radial',
  composed: 'Composed',
};

const CONSOLIDATION_LIMITS: Record<string, number> = {
  pie: 8,
  donut: 8,
  radar: 10,
  radial_bar: 8,
  treemap: 20,
};

function resolveChartHeight(type: string, dataCount: number): number {
  switch (type) {
    case 'pie':
    case 'donut':
    case 'treemap':
    case 'radial_bar':
      return 260;
    case 'radar':
      return 280;
    case 'horizontal_bar':
      return Math.max(220, Math.min(dataCount * 28, 420));
    case 'funnel':
      return Math.max(200, Math.min(dataCount * 36, 380));
    default:
      return 300;
  }
}

function consolidateData(
  data: Record<string, unknown>[],
  type: string,
  xKey: string,
  yKey: string | undefined,
): Record<string, unknown>[] {
  const maxSlices = CONSOLIDATION_LIMITS[type];
  if (!maxSlices || data.length <= maxSlices) {
    return data;
  }

  const valueKey = yKey || 'value';
  const sorted = [...data].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0));
  const top = sorted.slice(0, maxSlices - 1);
  const rest = sorted.slice(maxSlices - 1);
  const otherValue = rest.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);

  return [...top, { [xKey]: `Other (${rest.length})`, [valueKey]: otherValue }];
}

interface ChatChartCardProps {
  part: ChartPart;
  appId: string;
  sessionId: string | null;
  onSaved?: (chartPart: ChartPart, toast: SaveToastPart) => void;
}

export function ChatChartCard({ part, appId, sessionId, onSaved }: ChatChartCardProps) {
  const [activeType, setActiveType] = useState(part.spec.type);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayData = useMemo(
    () => consolidateData(part.data, activeType, part.spec.xKey, part.spec.yKey),
    [activeType, part.data, part.spec.xKey, part.spec.yKey],
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(part.sqlQuery);
    setCopied(true);
    notificationService.success('SQL copied');
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    if (saving || part.saved) {
      return;
    }

    setSaving(true);
    try {
      const saved = await analyticsLibraryApi.saveChart({
        appId,
        title: part.spec.title,
        sqlQuery: part.sqlQuery,
        chartConfig: {
          type: activeType,
          xKey: part.spec.xKey,
          yKey: part.spec.yKey,
          seriesKeys: part.spec.seriesKeys,
          series: part.spec.series,
          xLabel: part.spec.xLabel,
          yLabel: part.spec.yLabel,
          legendPosition: part.spec.legendPosition,
        },
        sourceQuestion: part.sourceQuestion,
        sourceSessionId: sessionId ?? undefined,
      });

      onSaved?.(
        { ...part, saved: true, chartId: saved.id },
        {
          type: 'save-toast',
          variant: 'chart',
          title: 'Chart saved',
          subtitle: part.spec.title,
          linkText: 'View',
          linkHref: analyticsChartForApp(appId, saved.id),
        },
      );
      notificationService.success('Chart saved to library');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to save chart');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">{part.spec.title}</div>
          {part.sourceQuestion !== part.spec.title ? (
            <div className="mt-1 line-clamp-1 text-xs text-[var(--text-muted)]">{part.sourceQuestion}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={() => void handleCopy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant={part.saved ? 'secondary' : 'primary'} size="sm" icon={part.saved ? Check : Save} disabled={part.saved || saving} isLoading={saving} onClick={() => void handleSave()}>
            {part.saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
      <div className="px-4 pt-2 pb-3">
        <ChartRenderer
          type={activeType}
          data={displayData}
          xKey={part.spec.xKey}
          yKey={part.spec.yKey}
          seriesKeys={part.spec.seriesKeys}
          series={part.spec.series}
          xLabel={part.spec.xLabel}
          yLabel={part.spec.yLabel}
          legendPosition={part.spec.legendPosition}
          height={resolveChartHeight(activeType, displayData.length)}
          compact
        />
      </div>
      {part.spec.alternatives?.length ? (
        <div className="flex flex-wrap gap-2 border-t border-[var(--border-default)] px-4 py-3">
          {part.spec.alternatives.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setActiveType(type)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                activeType === type
                  ? 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]'
                  : 'border-[var(--border-default)] text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
              )}
            >
              {TYPE_LABELS[type] ?? type}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
