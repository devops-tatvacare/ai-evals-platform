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

import type {
  ChartPart,
  ChartPayload,
  ChartPayloadChart,
  SaveToastPart,
  VegaLiteSpec,
} from '../types';
import { ChatArtifactCard } from './ChatArtifactCard';
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
      return vegaLiteToRecharts(payload.spec as unknown as VegaLiteSpec, payload.data);
    } catch (error) {
      // The backend boundary should have rejected this already; degrade
      // gracefully in the UI and leave translation errors for debugging.
      notificationService.error(
        error instanceof Error ? error.message : 'Could not render chart',
      );
      return null;
    }
  }, [payload]);

  const sql = payload.sql_query?.trim();
  const copyText = sql || copyablePayload(payload);
  const canCopy = Boolean(copyText);
  const canSave = payload.kind === 'chart' && chartProps !== null;

  const handleCopy = async () => {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    notificationService.success(sql ? 'SQL copied' : 'Data copied');
    window.setTimeout(() => setCopied(false), 1500);
  };

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

  const title = titleFor(payload);
  const question = payload.source_question?.trim();
  const subtitle = question && question !== title ? question : undefined;
  const isChart = payload.kind === 'chart' && chartProps !== null;
  const warning = payload.kind === 'chart' && chartProps === null
    ? (payload.warning?.trim() || 'Could not render chart; showing raw data.')
    : payload.warning ?? null;

  const actions = (canCopy || canSave) ? (
    <>
      {canCopy ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={copied ? Check : Copy}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied' : 'Copy'}
          onClick={() => void handleCopy()}
        />
      ) : null}
      {payload.kind === 'chart' ? (
        <Button
          variant={part.saved ? 'secondary' : 'primary'}
          size="sm"
          iconOnly
          icon={part.saved ? Check : Save}
          aria-label={part.saved ? 'Saved' : 'Save'}
          title={part.saved ? 'Saved' : 'Save'}
          disabled={part.saved || saving || !canSave}
          isLoading={saving}
          onClick={() => void handleSave()}
        />
      ) : null}
    </>
  ) : null;

  return (
    <ChatArtifactCard
      kind={payload.kind}
      title={title}
      subtitle={subtitle}
      warning={warning}
      actions={actions}
      bodyRef={isChart ? chartFrameRef : undefined}
      bodyClassName={isChart ? 'px-4 pb-3 pt-2' : undefined}
    >
      <ArtifactBody
        payload={payload}
        chartProps={chartProps}
        chartFrameWidth={chartFrameWidth}
      />
    </ChatArtifactCard>
  );
}

function ArtifactBody({
  payload, chartProps, chartFrameWidth,
}: {
  payload: ChartPayload;
  chartProps: ReturnType<typeof vegaLiteToRecharts> | null;
  chartFrameWidth: number | undefined;
}) {
  if (payload.kind === 'empty') {
    return (
      <div className="py-4 text-center text-xs text-[var(--text-muted)]">
        No data for this question.
      </div>
    );
  }
  if (payload.kind === 'kpi') return <ChatKpiCard kpi={payload.kpi} />;
  if (payload.kind === 'summary') return <ChatSummaryCard summary={payload.summary} />;
  if (payload.kind === 'table') return <ChatTableCard columns={payload.columns} data={payload.data} />;

  // kind === 'chart': fall back to raw rows when translation failed.
  if (!chartProps) return <ChatTableCard columns={[]} data={payload.data} />;

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
}
