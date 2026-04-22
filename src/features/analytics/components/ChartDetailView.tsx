import { useEffect, useState, useCallback, useRef } from 'react';
import { ArrowLeft, RefreshCw, Trash2, Globe2, Lock, Pencil, Check, X } from 'lucide-react';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { Badge, VisibilityBadge } from '@/components/ui';
import { ActionIconButton } from '@/features/evalRuns/components/RunHeaderActions';
import { ChartRenderer } from './ChartRenderer';
import { deriveChartLayout } from '../chartLayout';
import { useMeasuredWidth } from '../useMeasuredWidth';
import { vegaLiteToRecharts } from '../vegaLiteToRecharts';
import type { SavedChart } from '../types';

interface ChartDetailViewProps {
  chart: SavedChart;
  onBack: () => void;
  onDelete?: (id: string) => void;
  onUpdate?: (updated: SavedChart) => void;
}

export function ChartDetailView({ chart, onBack, onDelete, onUpdate }: ChartDetailViewProps) {
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

  const currentTitle = editing ? editTitle : chart.title;
  const currentDesc = editing ? editDesc : chart.description;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3 min-w-0">
          <ActionIconButton icon={ArrowLeft} label="Back" onClick={onBack} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editing ? (
                <input
                  ref={titleRef}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="text-base font-semibold text-[var(--text-primary)] bg-transparent border-b border-[var(--border-default)] focus:border-[var(--color-brand-primary)] outline-none min-w-[200px]"
                />
              ) : (
                <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">{currentTitle}</h2>
              )}
              <Badge variant="info" size="sm">{chart.chartConfig.renderer.type.replace(/_/g, ' ')}</Badge>
              <VisibilityBadge visibility={visibility} compact />
            </div>
            {editing ? (
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a description..."
                className="text-xs text-[var(--text-muted)] bg-transparent border-b border-[var(--border-default)] focus:border-[var(--color-brand-primary)] outline-none mt-1 w-full max-w-[600px]"
              />
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate max-w-[600px]">
                {currentDesc || chart.sourceQuestion}
              </p>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {editing ? (
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
                icon={isShared ? Globe2 : Lock}
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
          )}
        </div>
      </div>

      {/* Chart body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading || !data ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--text-muted)]">Loading chart...</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--text-muted)]">
            No data returned. The underlying query may have expired or returned empty results.
          </div>
        ) : (
          <div ref={chartBodyRef} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-6">
            {(() => {
              let replayProps: { type: string; data: Record<string, unknown>[]; xKey: string; yKey?: string; seriesKeys?: string[]; xLabel?: string; yLabel?: string } | null = null;
              if (chart.chartConfig.canonical?.kind === 'chart') {
                try {
                  replayProps = vegaLiteToRecharts(chart.chartConfig.canonical.spec, data);
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
    </div>
  );
}
