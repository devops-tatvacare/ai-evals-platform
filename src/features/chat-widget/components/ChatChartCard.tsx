import { useMemo, useState } from 'react';
import { Check, Copy, Save } from 'lucide-react';

import { Button } from '@/components/ui';
import { analyticsChartForApp } from '@/config/routes';
import { ChartRenderer } from '@/features/analytics/components/ChartRenderer';
import { deriveChartLayout } from '@/features/analytics/chartLayout';
import { useMeasuredWidth } from '@/features/analytics/useMeasuredWidth';
import { vegaLiteToRecharts } from '@/features/analytics/vegaLiteToRecharts';
import { analyticsLibraryApi } from '@/services/api/analyticsLibraryApi';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils/cn';

import type {
  ChartPart,
  ChartPayload,
  ChartPayloadChart,
  SaveToastPart,
} from '../types';
import { ChatKpiCard } from './ChatKpiCard';
import { ChatSummaryCard } from './ChatSummaryCard';
import { ChatTableCard } from './ChatTableCard';

interface ChatChartCardProps {
  part: ChartPart;
  appId: string;
  sessionId: string | null;
  onSaved?: (chartPart: ChartPart, toast: SaveToastPart) => void;
}


function titleFor(payload: ChartPayload): string | undefined {
  return payload.title?.trim() || undefined;
}

function copyablePayload(payload: ChartPayload): string {
  if (payload.kind === 'chart') return JSON.stringify(payload.data, null, 2);
  if (payload.kind === 'table') return JSON.stringify(payload.data, null, 2);
  if (payload.kind === 'kpi') return JSON.stringify(payload.kpi, null, 2);
  if (payload.kind === 'summary') return JSON.stringify(payload.summary, null, 2);
  return '';
}

export function ChatChartCard({ part, appId, sessionId, onSaved }: ChatChartCardProps) {
  const payload = part.payload;
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const { ref: chartFrameRef, width: chartFrameWidth } = useMeasuredWidth<HTMLDivElement>();

  // Translate once per payload so handleSave and the body share the same
  // props without recomputing on every keystroke elsewhere in the tree.
  const chartProps = useMemo(() => {
    if (payload.kind !== 'chart') return null;
    try {
      return vegaLiteToRecharts(payload.spec, payload.data);
    } catch (error) {
      // The backend boundary should have rejected this already; degrade
      // gracefully in the UI and leave translation errors for debugging.
      notificationService.error(
        error instanceof Error ? error.message : 'Could not render chart',
      );
      return null;
    }
  }, [payload]);

  const handleCopy = async () => {
    const sql = payload.sql_query?.trim();
    const text = sql || copyablePayload(payload);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    notificationService.success(sql ? 'SQL copied' : 'Data copied');
    window.setTimeout(() => setCopied(false), 1500);
  };

  const canSave = payload.kind === 'chart' && chartProps !== null;

  const handleSave = async () => {
    if (!canSave || saving || part.saved) return;
    const chartPayload = payload as ChartPayloadChart;
    const props = chartProps!;
    const title = titleFor(payload) ?? 'Untitled chart';

    setSaving(true);
    try {
        const saved = await analyticsLibraryApi.saveChart({
          appId,
          title,
          sqlQuery: chartPayload.sql_query ?? '',
          chartConfig: {
            canonical: {
              kind: 'chart',
              spec: chartPayload.spec,
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
          sourceQuestion: chartPayload.source_question ?? '',
          sourceSessionId: sessionId ?? undefined,
      });

      onSaved?.(
        { ...part, saved: true, chartId: saved.id },
        {
          type: 'save-toast',
          variant: 'chart',
          title: 'Chart saved',
          subtitle: title,
          linkText: 'View',
          linkHref: analyticsChartForApp(appId, saved.id),
        },
      );
      notificationService.success('Chart saved to library');
    } catch (error) {
      notificationService.error(
        error instanceof Error ? error.message : 'Failed to save chart',
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Body by kind ────────────────────────────────────────────────
  if (payload.kind === 'empty') {
    return (
      <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-6 text-center text-xs text-[var(--text-muted)]">
        {titleFor(payload) ?? 'No data for this question.'}
      </div>
    );
  }

  if (payload.kind === 'kpi') {
    return (
      <ChatKpiCard
        kpi={payload.kpi}
        title={titleFor(payload)}
        warning={payload.warning ?? undefined}
      />
    );
  }

  if (payload.kind === 'summary') {
    return (
      <ChatSummaryCard
        summary={payload.summary}
        title={titleFor(payload)}
        warning={payload.warning ?? undefined}
      />
    );
  }

  if (payload.kind === 'table') {
    return (
      <ChatTableCard
        columns={payload.columns}
        data={payload.data}
        title={titleFor(payload)}
        warning={payload.warning ?? undefined}
      />
    );
  }

  // kind === 'chart'
  if (!chartProps) {
    return (
      <ChatTableCard
        columns={[]}
        data={payload.data}
        title={titleFor(payload)}
        warning="Could not render chart; showing raw data."
      />
    );
  }

  const title = titleFor(payload);
  const question = payload.source_question?.trim();

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0">
          {title ? (
            <div className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">
              {title}
            </div>
          ) : null}
          {question && question !== title ? (
            <div className="mt-1 line-clamp-1 text-xs text-[var(--text-muted)]">
              {question}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? Check : Copy}
            onClick={() => void handleCopy()}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant={part.saved ? 'secondary' : 'primary'}
            size="sm"
            icon={part.saved ? Check : Save}
            disabled={part.saved || saving || !canSave}
            isLoading={saving}
            onClick={() => void handleSave()}
          >
            {part.saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
      {payload.warning ? (
        <div
          className={cn(
            'border-b border-[var(--border-warning)] bg-[var(--surface-warning)]',
            'px-4 py-2 text-[11px] text-[var(--color-warning-dark)]',
          )}
        >
          {payload.warning}
        </div>
      ) : null}
      <div ref={chartFrameRef} className="px-4 pb-3 pt-2">
        {(() => {
          const layout = deriveChartLayout({
            surface: 'chat',
            type: chartProps.type,
            dataCount: chartProps.data.length,
            width: chartFrameWidth,
            compact: true,
          });
          return (
            <ChartRenderer
              type={chartProps.type}
              data={chartProps.data}
              xKey={chartProps.xKey}
              yKey={chartProps.yKey}
              seriesKeys={chartProps.seriesKeys}
              xLabel={chartProps.xLabel}
              yLabel={chartProps.yLabel}
              legendPosition={layout.legendPosition}
              yAxisWidthOverride={layout.yAxisWidth}
              marginOverride={layout.margin}
              tickFontSizeOverride={layout.tickFontSize}
              xTickCharCapOverride={layout.xTickCharCap}
              xTickIntervalOverride={layout.xTickInterval}
              height={layout.height}
              compact
            />
          );
        })()}
      </div>
    </div>
  );
}
