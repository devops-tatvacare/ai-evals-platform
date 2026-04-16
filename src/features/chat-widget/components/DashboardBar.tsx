import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, LayoutDashboard, Minus, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { analyticsDashboardForApp } from '@/config/routes';
import type { ChartPart, SaveToastPart } from '../types';

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

  const uniqueCharts = useMemo(() => {
    const seen = new Set<string>();
    return charts.filter((chart) => {
      const key = chart.chartId ?? `${chart.spec.title}:${chart.sqlQuery}`;
      if (seen.has(key)) {
        return false;
      }
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

        const savedChart = await analyticsLibraryApi.saveChart({
          appId,
          title: chart.spec.title,
          sqlQuery: chart.sqlQuery,
          chartConfig: {
            type: chart.spec.type,
            xKey: chart.spec.xKey,
            yKey: chart.spec.yKey,
            seriesKeys: chart.spec.seriesKeys,
            series: chart.spec.series,
            xLabel: chart.spec.xLabel,
            yLabel: chart.spec.yLabel,
            legendPosition: chart.spec.legendPosition,
          },
          sourceQuestion: chart.sourceQuestion,
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
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-[var(--border-default)]',
          'bg-[var(--bg-secondary)] px-3 py-2 text-left',
          'hover:border-[var(--border-brand)] hover:bg-[var(--surface-brand-subtle)]',
          'transition-colors group',
        )}
      >
        <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-[var(--text-brand)]" />
        <span className="flex-1 text-xs font-medium text-[var(--text-primary)]">
          Create dashboard
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {uniqueCharts.length} charts
        </span>
        <ChevronUp className="h-3 w-3 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
          className="ml-1 flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </button>
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
        {uniqueCharts.map((chart, index) => (
          <div key={`${chart.chartId ?? chart.sqlQuery}-${index}`} className="min-w-[100px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2">
            <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">{chart.spec.title}</div>
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
        ))}
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
