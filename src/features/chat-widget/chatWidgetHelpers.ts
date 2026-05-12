import type {
  Artifact,
  BlueprintPart,
  BlueprintSection,
  ChartPart,
  ComposedReport,
  JobBadgePart,
  JobBadgeStatus,
  MessagePart,
  SaveToastPart,
  StoredToolCallOutcome,
  StoredWidgetMetadata,
  ToolCallPart,
  WidgetMessage,
} from './types';
import { validateChartPayload } from './types';
import { normalizeSpecialistRoutingTelemetry } from './routingTelemetry';

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

export function isJobBadgePart(part: MessagePart): part is JobBadgePart {
  return part.type === 'job-badge';
}

// Phase 7 audit fix (Gap 5): synthesize a ``JobBadgePart`` from a tool
// outcome. Returns ``null`` when the outcome has no ``job`` slot — i.e.
// the tool didn't submit a platform job and no badge is needed.
export function jobBadgeFromOutcome(
  outcome: StoredToolCallOutcome | undefined | null,
  toolName: string | undefined,
  summary: string | undefined,
): JobBadgePart | null {
  const job = outcome?.job;
  const jobId = typeof job?.id === 'string' ? job.id : undefined;
  const status = job?.status as JobBadgeStatus | undefined;
  if (!jobId || !status) {
    return null;
  }
  return {
    type: 'job-badge',
    jobId,
    jobType: toolName,
    status,
    summary,
  };
}

export function upsertJobBadgePart(parts: MessagePart[], next: JobBadgePart): MessagePart[] {
  const index = parts.findIndex((part) => isJobBadgePart(part) && part.jobId === next.jobId);
  if (index === -1) {
    return [...parts, next];
  }
  const updated = [...parts];
  const existing = updated[index] as JobBadgePart;
  // Preserve any client-side overlay (e.g. resultHref once the polling
  // resolves) unless the incoming event supplies a fresh value.
  updated[index] = {
    ...existing,
    ...next,
    summary: next.summary ?? existing.summary,
    jobType: next.jobType ?? existing.jobType,
    resultHref: next.resultHref ?? existing.resultHref,
  };
  return updated;
}

export function getToolPartIndex(parts: MessagePart[], toolCallId: string): number {
  return parts.findIndex((part) => isToolCallPart(part) && part.toolCallId === toolCallId);
}

function hasMeaningfulToolDetail(part: ToolCallPart): boolean {
  const detail = part.detail;
  return Boolean(
    detail?.error ||
    detail?.sqlUsed ||
    typeof detail?.rowCount === 'number' ||
    typeof detail?.cacheHit === 'boolean' ||
    (typeof detail?.executionMs === 'number' && detail.executionMs > 0),
  );
}

export function upsertToolPart(parts: MessagePart[], next: ToolCallPart): MessagePart[] {
  const index = getToolPartIndex(parts, next.toolCallId);
  if (index === -1) {
    let placeholderIndex = -1;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (
        isToolCallPart(part) &&
        part.toolName === next.toolName &&
        !part.routing &&
        !hasMeaningfulToolDetail(part) &&
        Boolean(next.routing)
      ) {
        placeholderIndex = i;
        break;
      }
    }
    if (placeholderIndex !== -1) {
      const updated = [...parts];
      updated[placeholderIndex] = {
        ...(updated[placeholderIndex] as ToolCallPart),
        ...next,
      };
      return updated;
    }
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

// Phase 6 §741: the hand-written ``isChartPayload`` is replaced by an
// ``ajv``-precompiled validator generated from the same Pydantic JSON
// Schema as the backend. The re-export below preserves the historical
// name so call-sites keep working without churn.
export const isChartPayload = validateChartPayload;

// Phase 1 — harness-owned artifact triple. Pack-produced results land in
// message metadata / the ``turn_finished`` event as ``{pack_id, contract_id,
// payload, extras?}`` records; the frontend dispatches on ``pack_id`` +
// ``contract_id`` to render chart / blueprint / future pack outputs.
export function isArtifact(raw: unknown): raw is Artifact {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return typeof obj.pack_id === 'string'
    && typeof obj.contract_id === 'string'
    && 'payload' in obj;
}

function blueprintPartFromArtifactPayload(payload: unknown): BlueprintPart | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const obj = payload as Record<string, unknown>;
  const rawSections = Array.isArray(obj.sections) ? obj.sections : [];
  const sections: BlueprintSection[] = rawSections
    .filter((section): section is Record<string, unknown> => !!section && typeof section === 'object')
    .map((section) => ({
      id: typeof section.id === 'string' ? section.id : '',
      type: typeof section.type === 'string' ? section.type : '',
      title: typeof section.title === 'string' ? section.title : (typeof section.type === 'string' ? section.type : ''),
      variant: typeof section.variant === 'string' ? section.variant : undefined,
    }));
  const rawName = (typeof obj.report_name === 'string' && obj.report_name)
    || (typeof obj.name === 'string' && obj.name)
    || 'Untitled';
  return {
    type: 'blueprint',
    name: rawName,
    sections,
  };
}

export function applyArtifactToParts(parts: MessagePart[], artifact: Artifact): MessagePart[] {
  if (artifact.pack_id === 'analytics' && artifact.contract_id === 'analytics.chart.v1') {
    if (isChartPayload(artifact.payload)) {
      return replaceOrAppendPart(parts, isChartPart, {
        type: 'chart',
        payload: artifact.payload,
      });
    }
    return parts;
  }
  if (artifact.pack_id === 'report_builder' && artifact.contract_id === 'report_builder.blueprint.v1') {
    const blueprintPart = blueprintPartFromArtifactPayload(artifact.payload);
    if (blueprintPart) {
      return replaceOrAppendPart(parts, isBlueprintPart, blueprintPart);
    }
    return parts;
  }
  return parts;
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
  // This matches the live order (specialist events → content_delta → chart → turn_finished)
  // and ensures tool calls appear above the text response, not below.
  let parts: MessagePart[] = [];

  for (const toolCall of metadata?.toolCalls ?? []) {
    // Replay shim: pre-Phase-2 persisted sessions may store a tool call
    // without ``toolCallId``. New turns always emit it; this guard keeps
    // old rows renderable and is tracked in docs/plans/sherlock-shim-ledger.md
    // (deletion trigger: drop historical chat-widget sessions).
    if (!toolCall.toolCallId) {
      continue;
    }
    parts = upsertToolPart(parts, {
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.name,
      summary: toolCall.summary,
      detail: toolCall.detail ?? null,
      routing: normalizeSpecialistRoutingTelemetry(toolCall.routing),
      state: toolCall.detail?.error ? 'error' : 'completed',
      durationMs: toolCall.detail?.executionMs,
    });
    // Phase 7 audit fix (Gap 5): rehydrate a ``JobBadgePart`` from the
    // persisted outcome so reload/replay shows the same badge the live
    // turn did.
    const badge = jobBadgeFromOutcome(toolCall.outcome, toolCall.name, toolCall.summary);
    if (badge) {
      parts = upsertJobBadgePart(parts, badge);
    }
  }

  if (content) {
    parts = appendTextPart(parts, content);
  }

  for (const artifact of metadata?.artifacts ?? []) {
    if (isArtifact(artifact)) {
      parts = applyArtifactToParts(parts, artifact);
    }
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
