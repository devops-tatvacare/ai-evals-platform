import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Trash2, Share2, Lock, Pencil, Check, X } from 'lucide-react';
import { analyticsLibraryForApp } from '@/config/routes';
import { useCurrentAppId } from '@/hooks';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { Badge, LoadingState, PageSurface, VisibilityBadge } from '@/components/ui';
import { ActionIconButton } from '@/features/evalRuns/components/RunHeaderActions';
import { PAGE_METADATA } from '@/config/pageMetadata';
import { ChartRenderer } from './ChartRenderer';
import { deriveChartLayout } from '../chartLayout';
import { useMeasuredWidth } from '../useMeasuredWidth';
import { vegaLiteToRecharts } from '../vegaLiteToRecharts';
import { toValidatedChartPayload } from '../chartReplayValidation';
import type { SavedChart } from '../types';
import type { VegaLiteSpec } from '@/features/chat-widget/types';

interface ChartDetailViewProps {
  chart: SavedChart;
  onBack: () => void;
  onDelete?: (id: string) => void;
  onUpdate?: (updated: SavedChart) => void;
}

export function ChartDetailView({ chart, onBack, onDelete, onUpdate }: ChartDetailViewProps) {
  const appId = useCurrentAppId();
  const [data, setData] = useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [visibility, setVisibility] = useState(chart.visibility);

  // Inline editing
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chart.title);
  const [editDesc, setEditDesc] = useState(chart.description);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const { ref: chartBodyRef, width: chartBodyWidth } = useMeasuredWidth<HTMLDivElement>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await analyticsLibraryApi.getChartData(chart.id);
      setData(result.data);
    } catch {
      notificationService.error('Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [chart.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  const isShared = visibility === 'shared';

  const handleToggleVisibility = async () => {
    setToggling(true);
    const newVis = isShared ? 'private' : 'shared';
    try {
      const updated = await analyticsLibraryApi.updateChart(chart.id, { visibility: newVis });
      setVisibility(updated.visibility);
      onUpdate?.(updated);
      notificationService.success('Visibility updated');
    } catch {
      notificationService.error('Failed to update visibility');
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await analyticsLibraryApi.deleteChart(chart.id);
      notificationService.success('Chart deleted');
      onDelete?.(chart.id);
      onBack();
    } catch {
      notificationService.error('Failed to delete chart');
      setDeleting(false);
    }
  };

  const handleStartEdit = () => {
    setEditTitle(chart.title);
    setEditDesc(chart.description);
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  const handleSaveEdit = async () => {
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) return;
    if (trimmedTitle === chart.title && editDesc === chart.description) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await analyticsLibraryApi.updateChart(chart.id, {
        title: trimmedTitle,
        description: editDesc,
      });
      onUpdate?.(updated);
      setEditing(false);
      notificationService.success('Chart updated');
    } catch {
      notificationService.error('Failed to update chart');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSaveEdit();
    if (e.key === 'Escape') handleCancelEdit();
  };

  const subtitle = (
    <>
      <Badge variant="info" size="sm">{chart.chartConfig.renderer.type.replace(/_/g, ' ')}</Badge>
      <VisibilityBadge visibility={visibility} compact />
    </>
  );

  const actions = editing ? (
    <>
      <ActionIconButton
        icon={Check}
        label="Save"
        tooltip="Save changes"
        onClick={() => void handleSaveEdit()}
        disabled={saving || !editTitle.trim()}
        spinning={saving}
      />
      <ActionIconButton
        icon={X}
        label="Cancel"
        tooltip="Cancel editing"
        onClick={handleCancelEdit}
      />
    </>
  ) : (
    <>
      <ActionIconButton
        icon={Pencil}
        label="Edit title and description"
        tooltip="Edit"
        onClick={handleStartEdit}
      />
      <ActionIconButton
        icon={isShared ? Share2 : Lock}
        label={isShared ? 'Shared — click to make private' : 'Private — click to share'}
        tooltip={isShared ? 'Shared — click to make private' : 'Private — click to share'}
        onClick={() => void handleToggleVisibility()}
        disabled={toggling}
        spinning={toggling}
      />
      <ActionIconButton
        icon={RefreshCw}
        label="Refresh data"
        tooltip="Refresh data"
        onClick={() => void load()}
        disabled={loading}
        spinning={loading}
      />
      <span className="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />
      <ActionIconButton
        icon={Trash2}
        label="Delete chart"
        tooltip="Delete chart"
        onClick={() => void handleDelete()}
        disabled={deleting}
        variant="danger"
        spinning={deleting}
      />
    </>
  );
  const back = { to: analyticsLibraryForApp(appId), label: 'Analytics' };

  return (
    <PageSurface
      icon={PAGE_METADATA.analyticsChart.icon}
      title={editing ? editTitle : chart.title}
      subtitle={subtitle}
      back={back}
      actions={actions}
    >
      {editing && (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
          <label className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Title</label>
          <input
            ref={titleRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            className="bg-transparent text-sm font-semibold text-[var(--text-primary)] outline-none"
          />
          <label className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Description</label>
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a description..."
            className="bg-transparent text-xs text-[var(--text-secondary)] outline-none"
          />
        </div>
      )}
      {!editing && (chart.description || chart.sourceQuestion) && (
        <p className="mb-4 text-xs text-[var(--text-muted)]">{chart.description || chart.sourceQuestion}</p>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading || !data ? (
          <LoadingState message="Loading chart…" />
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
            No data returned. The underlying query may have expired or returned empty results.
          </div>
        ) : (
          <div ref={chartBodyRef} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-6">
            {(() => {
              // Phase 6 §743: replay path must validate through the
              // generated chart-contract validator before rendering. A
              // failed validation falls back to the stored renderer
              // instead of silently trusting a shape-checked payload.
              let replayProps: { type: string; data: Record<string, unknown>[]; xKey: string; yKey?: string; seriesKeys?: string[]; xLabel?: string; yLabel?: string } | null = null;
              const validated = toValidatedChartPayload(chart.chartConfig.canonical, data);
              if (validated !== null) {
                try {
                  replayProps = vegaLiteToRecharts(validated.spec as unknown as VegaLiteSpec, validated.data);
                } catch {
                  replayProps = null;
                }
              }
              const renderer = chart.chartConfig.renderer;
              const type = replayProps?.type ?? renderer.type;
              const layout = deriveChartLayout({
                surface: 'detail',
                type,
                dataCount: data.length,
                width: chartBodyWidth,
              });
              if (replayProps) {
                return (
                  <ChartRenderer
                    type={replayProps.type}
                    data={replayProps.data}
                    xKey={replayProps.xKey}
                    yKey={replayProps.yKey}
                    seriesKeys={replayProps.seriesKeys}
                    xLabel={replayProps.xLabel ?? renderer.xLabel}
                    yLabel={replayProps.yLabel ?? renderer.yLabel}
                    legendPosition={layout.legendPosition}
                    yAxisWidthOverride={layout.yAxisWidth}
                    marginOverride={layout.margin}
                    tickFontSizeOverride={layout.tickFontSize}
                    xTickCharCapOverride={layout.xTickCharCap}
                    xTickIntervalOverride={layout.xTickInterval}
                    height={layout.height}
                  />
                );
              }
              return (
                <ChartRenderer
                  type={renderer.type}
                  data={data}
                  xKey={renderer.xKey}
                  yKey={renderer.yKey}
                  seriesKeys={renderer.seriesKeys}
                  series={renderer.series}
                  xLabel={renderer.xLabel}
                  yLabel={renderer.yLabel}
                  legendPosition={renderer.legendPosition ?? layout.legendPosition}
                  yAxisWidthOverride={layout.yAxisWidth}
                  marginOverride={layout.margin}
                  tickFontSizeOverride={layout.tickFontSize}
                  xTickCharCapOverride={layout.xTickCharCap}
                  xTickIntervalOverride={layout.xTickInterval}
                  height={layout.height}
                />
              );
            })()}
          </div>
        )}
      </div>
    </PageSurface>
  );
}
