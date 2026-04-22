import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  BarChart3,
  ChevronUp,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Minus,
  PieChart,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import {
  vegaLiteToRecharts,
  type RechartsChartType,
} from '@/features/analytics/vegaLiteToRecharts';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { analyticsDashboardForApp } from '@/config/routes';
import type { ChartPart, ChartPayloadChart, SaveToastPart, VegaLiteSpec } from '../types';

function asChartPayload(part: ChartPart): ChartPayloadChart | null {
  return part.payload.kind === 'chart' ? (part.payload as ChartPayloadChart) : null;
}

function keyOf(chart: ChartPart, payload: ChartPayloadChart | null, index: number): string {
  return chart.chartId ?? `${payload?.title ?? ''}:${payload?.sql_query ?? ''}:${index}`;
}

// Chart-type → glyph mapping is the only place that maps translator output to
// a visual. Keep it tight: the 6 canonical marks collapse into 4 shape
// families (bars, lines, area, pie). No per-index hardcoding — the icon
// reflects the actual rendered chart type.
function iconFor(type: RechartsChartType | undefined): LucideIcon {
  if (type === 'line') return LineChart;
  if (type === 'area') return AreaChart;
  if (type === 'pie') return PieChart;
  return BarChart3;
}

interface DashboardBarProps {
  appId: string;
  sessionId: string | null;
  charts: ChartPart[];
  defaultTitle?: string;
  onSaved?: (toast: SaveToastPart) => void;
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
  // Track which chart keys the user has explicitly opted out of. New charts
  // that appear in future turns stay selected by default — this is simpler
  // than maintaining a mirror "selected" set that needs syncing on arrival.
  const [deselected, setDeselected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (defaultTitle) {
      setTitle(defaultTitle);
    }
  }, [defaultTitle]);

  // Dashboard bar only groups actual charts — KPI/summary/table results are
  // not dashboard-able. Deduplicate by saved id or by (title, sql) and
  // precompute the translator-derived preview metadata once per payload.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      chart: ChartPart;
      payload: ChartPayloadChart;
      key: string;
      title: string;
      type: RechartsChartType | undefined;
    }> = [];
    charts.forEach((chart, index) => {
      const payload = asChartPayload(chart);
      if (!payload) return;
      const key = keyOf(chart, payload, index);
      if (seen.has(key)) return;
      seen.add(key);
      let type: RechartsChartType | undefined;
      try {
        type = vegaLiteToRecharts(payload.spec as unknown as VegaLiteSpec, payload.data).type;
      } catch {
        type = undefined;
      }
      out.push({
        chart,
        payload,
        key,
        title: payload.title?.trim() || 'Untitled chart',
        type,
      });
    });
    return out;
  }, [charts]);

  const activeItems = useMemo(
    () => items.filter((item) => !deselected.has(item.key)),
    [items, deselected],
  );

  const toggle = (key: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (items.length < 2 || dismissed) {
    return null;
  }

  const handleCreate = async () => {
    if (saving || activeItems.length < 1) {
      return;
    }

    setSaving(true);
    try {
      const chartIds: string[] = [];

      for (const { chart, payload } of activeItems) {
        if (chart.chartId) {
          chartIds.push(chart.chartId);
          continue;
        }

        const props = vegaLiteToRecharts(payload.spec as unknown as VegaLiteSpec, payload.data);
        const savedChart = await analyticsLibraryApi.saveChart({
          appId,
          title: payload.title ?? 'Untitled chart',
          sqlQuery: payload.sql_query ?? '',
          chartConfig: {
            canonical: {
              kind: 'chart',
              spec: payload.spec as unknown as VegaLiteSpec,
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
            {activeItems.length === items.length
              ? `${items.length} charts`
              : `${activeItems.length} of ${items.length} charts`}
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
          <span className="text-[11px] text-[var(--text-muted)]">
            {activeItems.length === items.length
              ? `${items.length} charts`
              : `${activeItems.length} of ${items.length} charts`}
          </span>
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

      <div className="flex flex-nowrap gap-2 overflow-x-auto px-3 pb-2">
        {items.map((item) => {
          const Icon = iconFor(item.type);
          const selected = !deselected.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              aria-pressed={selected}
              title={selected ? 'Click to exclude from dashboard' : 'Click to include in dashboard'}
              className={cn(
                'shrink-0 w-[140px] rounded-lg border px-2.5 py-2 text-left transition-all',
                selected
                  ? 'border-[var(--border-brand)] bg-[var(--bg-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-primary)] opacity-40 hover:opacity-70',
              )}
            >
              <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">
                {item.title}
              </div>
              <div className="mt-1.5 flex h-8 items-center justify-center rounded bg-[var(--bg-secondary)]">
                <Icon
                  className={cn(
                    'h-5 w-5',
                    selected ? 'text-[var(--text-brand)]' : 'text-[var(--text-muted)]',
                  )}
                />
              </div>
            </button>
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
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={saving || activeItems.length < 1}
        >
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
