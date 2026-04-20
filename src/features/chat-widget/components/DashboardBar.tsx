import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, LayoutDashboard, Minus, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { vegaLiteToRecharts } from '@/features/analytics/vegaLiteToRecharts';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { analyticsDashboardForApp } from '@/config/routes';
import type { ChartPart, ChartPayloadChart, SaveToastPart } from '../types';

function asChartPayload(part: ChartPart): ChartPayloadChart | null {
  return part.payload.kind === 'chart' ? (part.payload as ChartPayloadChart) : null;
}

interface DashboardBarProps {
  appId: string;
  sessionId: string | null;
  charts: ChartPart[];
  defaultTitle?: string;
  onSaved?: (toast: SaveToastPart) => void;
}

function chartPreviewBars(index: number): number[] {
  return [30 + index * 8, 50 + index * 6, 42 + index * 7, 66 + index * 5];
}

export function DashboardBar({
  appId,
  sessionId,
  charts,
  defaultTitle,
  onSaved,
}: DashboardBarProps) {
  const [title, setTitle] = useState(defaultTitle ?? 'Untitled dashboard');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (defaultTitle) {
      setTitle(defaultTitle);
    }
  }, [defaultTitle]);

  // Dashboard bar only groups actual charts — KPI/summary/table results are
  // not dashboard-able. Deduplicate by saved id or by (title, sql).
  const uniqueCharts = useMemo(() => {
    const seen = new Set<string>();
    return charts.filter((chart) => {
      const payload = asChartPayload(chart);
      if (!payload) return false;
      const key = chart.chartId ?? `${payload.title ?? ''}:${payload.sql_query ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [charts]);

  if (uniqueCharts.length < 2 || dismissed) {
    return null;
  }

  const handleCreate = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    try {
      const chartIds: string[] = [];

      for (const chart of uniqueCharts) {
        if (chart.chartId) {
          chartIds.push(chart.chartId);
          continue;
        }

        const payload = asChartPayload(chart);
        if (!payload) continue;
        const props = vegaLiteToRecharts(payload.spec, payload.data);
        const savedChart = await analyticsLibraryApi.saveChart({
          appId,
          title: payload.title ?? 'Untitled chart',
          sqlQuery: payload.sql_query ?? '',
          chartConfig: {
            canonical: {
              kind: 'chart',
              spec: payload.spec,
            },
            renderer: {
              type: props.type,
              xKey: props.xKey,
              yKey: props.yKey,
              seriesKeys: props.seriesKeys,
              xLabel: props.xLabel,
              yLabel: props.yLabel,
            },
          },
          sourceQuestion: payload.source_question ?? '',
          sourceSessionId: sessionId ?? undefined,
        });
        chartIds.push(savedChart.id);
      }

      const dashboard = await analyticsLibraryApi.saveDashboard({
        appId,
        title: title.trim() || 'Untitled dashboard',
        chartIds,
        sourceSessionId: sessionId ?? undefined,
      });

      onSaved?.({
        type: 'save-toast',
        variant: 'dashboard',
        title: 'Dashboard created',
        subtitle: title.trim() || 'Untitled dashboard',
        linkText: 'Open',
        linkHref: analyticsDashboardForApp(appId, dashboard.id),
      });
      notificationService.success('Dashboard created');
      setDismissed(true);
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to create dashboard');
    } finally {
      setSaving(false);
    }
  };

  // ── Collapsed chip ────────────────────────────────────────────
  if (!expanded) {
    return (
      <div
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-[var(--border-default)]',
          'bg-[var(--bg-secondary)] px-3 py-2 text-left',
          'hover:border-[var(--border-brand)] hover:bg-[var(--surface-brand-subtle)]',
          'transition-colors group',
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-[var(--text-brand)]" />
          <span className="flex-1 text-xs font-medium text-[var(--text-primary)]">
            Create dashboard
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            {uniqueCharts.length} charts
          </span>
          <ChevronUp className="h-3 w-3 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ml-1 flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // ── Expanded panel ────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-[var(--text-brand)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Create dashboard</span>
          <span className="text-[11px] text-[var(--text-muted)]">{uniqueCharts.length} charts</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Minimize"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-3 pb-2">
        {uniqueCharts.map((chart, index) => {
          const payload = asChartPayload(chart);
          const previewTitle = payload?.title ?? 'Chart';
          const previewKey = chart.chartId ?? payload?.sql_query ?? `preview-${index}`;
          return (
          <div key={`${previewKey}-${index}`} className="min-w-[100px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2">
            <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">{previewTitle}</div>
            <div className="mt-1.5 flex h-8 items-end gap-0.5">
              {chartPreviewBars(index).map((height, barIndex) => (
                <span
                  key={`${barIndex}-${height}`}
                  className="w-2.5 rounded-t bg-[var(--interactive-primary)]/70"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
        );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border-default)] px-3 py-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Dashboard name"
          className="flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-brand)]"
        />
        <Button variant="primary" size="sm" onClick={() => void handleCreate()} disabled={saving}>
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
