import type { ComposedReport } from '@/features/reportBuilder/types';
import type {
  BlueprintPart,
  ChartPart,
  ChartPayload,
  MessagePart,
  SaveToastPart,
  StoredWidgetMetadata,
  ToolCallPart,
  WidgetMessage,
} from './types';

export function isToolCallPart(part: MessagePart): part is ToolCallPart {
  return part.type === 'tool-call';
}

export function isChartPart(part: MessagePart): part is ChartPart {
  return part.type === 'chart';
}

export function isBlueprintPart(part: MessagePart): part is BlueprintPart {
  return part.type === 'blueprint';
}

export function isSaveToastPart(part: MessagePart): part is SaveToastPart {
  return part.type === 'save-toast';
}

export function getToolPartIndex(parts: MessagePart[], toolCallId: string): number {
  return parts.findIndex((part) => isToolCallPart(part) && part.toolCallId === toolCallId);
}

export function upsertToolPart(parts: MessagePart[], next: ToolCallPart): MessagePart[] {
  const index = getToolPartIndex(parts, next.toolCallId);
  if (index === -1) {
    return [...parts, next];
  }

  const updated = [...parts];
  updated[index] = { ...updated[index], ...next };
  return updated;
}

export function appendTextPart(parts: MessagePart[], chunk: string): MessagePart[] {
  if (chunk.length === 0) {
    return parts;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === 'text') {
    return [
      ...parts.slice(0, -1),
      { ...lastPart, content: `${lastPart.content}${chunk}` },
    ];
  }

  return [...parts, { type: 'text', content: chunk }];
}

export function replaceOrAppendPart<TPart extends MessagePart>(
  parts: MessagePart[],
  matcher: (part: MessagePart) => part is TPart,
  next: TPart,
): MessagePart[] {
  const index = parts.findIndex((part) => matcher(part));
  if (index === -1) {
    return [...parts, next];
  }

  const updated = [...parts];
  updated[index] = next;
  return updated;
}

export function shouldApplyRuntimeSeq(lastAppliedSeq: number, nextSeq: number): boolean {
  return nextSeq > lastAppliedSeq;
}

/**
 * Rehydrate a persisted chart record into the Phase 4 ChartPayload union.
 *
 * - New-shape records carry a ``kind`` field — returned as-is.
 * - Pre-contract records carry ``{spec: {type, xKey, yKey, seriesKeys, …},
 *   data, sqlQuery, sourceQuestion}``. Those are wrapped as a minimal
 *   ``kind:'chart'`` payload with a Vega-Lite v5 subset spec so the
 *   vegaLiteToRecharts translator can still render them without a
 *   backfill migration.
 */
export function normalizeLegacyChartPayload(raw: unknown): ChartPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.kind === 'string') {
    return obj as unknown as ChartPayload;
  }

  const spec = obj.spec as Record<string, unknown> | undefined;
  const data = obj.data as unknown[] | undefined;
  if (!spec || !Array.isArray(data)) return null;

  const type = String(spec.type ?? 'bar');
  const xKey = String(spec.xKey ?? '');
  const yKey = spec.yKey ? String(spec.yKey) : undefined;
  const seriesKeys = Array.isArray(spec.seriesKeys)
    ? spec.seriesKeys.map(String).filter((k) => k.length > 0)
    : undefined;
  const xLabel = typeof spec.xLabel === 'string' && spec.xLabel ? spec.xLabel : xKey;
  const yLabel = typeof spec.yLabel === 'string' && spec.yLabel ? spec.yLabel : yKey ?? 'value';

  const isTemporalX = type === 'line' || type === 'area' || type === 'stacked_area';
  const xEnc = {
    field: xKey,
    type: isTemporalX ? ('temporal' as const) : ('nominal' as const),
    axis: { title: xLabel },
  };

  const title = typeof obj.title === 'string' ? obj.title
    : typeof (spec.title) === 'string' ? String(spec.title)
    : undefined;
  const sql_query = typeof obj.sqlQuery === 'string' ? obj.sqlQuery : undefined;
  const source_question = typeof obj.sourceQuestion === 'string' ? obj.sourceQuestion : undefined;
  const rowData = data as Array<Record<string, unknown>>;

  if (seriesKeys && seriesKeys.length > 1) {
    return {
      kind: 'chart',
      spec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        transform: [{ fold: seriesKeys, as: ['measure', 'value'] }],
        mark: type === 'line' || type === 'area' ? 'line' : 'bar',
        encoding: {
          x: xEnc,
          y: { field: 'value', type: 'quantitative' },
          color: { field: 'measure', type: 'nominal' },
        },
      },
      data: rowData,
      title,
      sql_query,
      source_question,
    };
  }

  const mark = type === 'pie' || type === 'donut'
    ? 'arc' as const
    : type === 'line' ? 'line' as const
    : type === 'area' || type === 'stacked_area' ? 'area' as const
    : 'bar' as const;

  if (mark === 'arc') {
    return {
      kind: 'chart',
      spec: {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        mark,
        encoding: {
          theta: { field: yKey ?? 'value', type: 'quantitative' },
          color: { field: xKey, type: 'nominal' },
        },
      },
      data: rowData,
      title,
      sql_query,
      source_question,
    };
  }

  return {
    kind: 'chart',
    spec: {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      mark,
      encoding: {
        x: xEnc,
        y: yKey
          ? { field: yKey, type: 'quantitative', axis: { title: yLabel } }
          : undefined,
      },
    },
    data: rowData,
    title,
    sql_query,
    source_question,
  };
}

export function buildComposedReportOutline(report: ComposedReport): string {
  const lines = report.sections.map((section) => {
    const title = section.title?.trim() || section.type;
    return `- ${title} (${section.type})`;
  });

  return [report.reportName, ...lines].join('\n');
}

export function partsFromStoredMessage(
  content: string,
  metadata: StoredWidgetMetadata | null | undefined,
): MessagePart[] {
  if (Array.isArray(metadata?.parts) && metadata.parts.length > 0) {
    return metadata.parts;
  }

  // Reconstruct parts in streaming order: tools → text → chart/blueprint.
  // This matches the live order (tool_call_start/end → content_delta → chart → done)
  // and ensures tool calls appear above the text response, not below.
  let parts: MessagePart[] = [];

  for (const toolCall of metadata?.toolCalls ?? []) {
    if (!toolCall.toolCallId) {
      continue;
    }
    parts = upsertToolPart(parts, {
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.name,
      summary: toolCall.summary,
      detail: toolCall.detail ?? null,
      state: toolCall.detail?.error ? 'error' : 'completed',
      durationMs: toolCall.detail?.executionMs,
    });
  }

  if (content) {
    parts = appendTextPart(parts, content);
  }

  if (metadata?.chart) {
    const normalized = normalizeLegacyChartPayload(metadata.chart);
    if (normalized) {
      parts = replaceOrAppendPart(parts, isChartPart, {
        type: 'chart',
        payload: normalized,
      });
    }
  }

  if (metadata?.blueprint) {
    parts = replaceOrAppendPart(parts, isBlueprintPart, metadata.blueprint);
  }

  if (metadata?.composedReport) {
    parts = replaceOrAppendPart(parts, isBlueprintPart, blueprintFromComposedReport(metadata.composedReport));
  }

  return parts;
}

export function mergeTerminalText(parts: MessagePart[], content?: string | null): MessagePart[] {
  if (!content) {
    return parts;
  }

  const textParts = parts.filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text');
  const lastText = textParts[textParts.length - 1];
  if (!lastText) {
    return appendTextPart(parts, content);
  }
  if (lastText.content === content) {
    return parts;
  }

  const lastTextIndex = parts.lastIndexOf(lastText);
  const updated = [...parts];
  updated[lastTextIndex] = { ...lastText, content };
  return updated;
}

export function blueprintFromComposedReport(report: ComposedReport): BlueprintPart {
  return {
    type: 'blueprint',
    name: report.reportName,
    sections: report.sections.map((section) => ({
      id: section.id,
      title: section.title,
      type: section.type,
      variant: section.variant,
    })),
  };
}

export function findLastChartParts(messages: WidgetMessage[]): ChartPart[] {
  return messages.flatMap((message) => message.parts.filter(isChartPart));
}
