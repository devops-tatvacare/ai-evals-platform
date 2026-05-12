export type ChatProvider = 'openai';
export type TerminalStatus = 'done' | 'error' | 'interrupted' | 'degraded';
export type TurnLifecycleStatus = 'queued' | 'active' | 'done' | 'degraded' | 'error' | 'interrupted';
export type RuntimeOperation = 'send' | 'resume';
export type SaveVariant = 'chart' | 'dashboard' | 'blueprint';

export interface ToolCallDetailData {
  executionMs: number;
  sqlUsed?: string | null;
  rowCount?: number | null;
  cacheHit?: boolean | null;
  error?: string | null;
}

export interface ToolCallBadgeData {
  toolCallId?: string;
  name: string;
  summary?: string;
  detail?: ToolCallDetailData | null;
  status: 'running' | 'done' | 'failed';
}

export interface SeriesConfig {
  dataKey: string;
  type: 'bar' | 'line' | 'area' | 'scatter';
  stackId?: string;
}

// ── Phase 6 chart-contract payload ─────────────────────────────────
// Types are codegen'd from the backend Pydantic ``ChartPayload`` model.
// The generator is ``scripts/codegen/generate_chart_contract.py`` +
// ``.js`` (run via ``npm run codegen:chart-contract``). The runtime
// validator (``chatWidgetHelpers.isChartPayload`` was the hand-written
// one; callers now use ``validateChartPayload`` from the generated
// module) is an ``ajv``-precompiled standalone function built from the
// same JSON Schema.
//
// Local minimal Vega-Lite typing stays hand-written — the backend chart
// spec carries only the fields the frontend reads (mark, encoding,
// transform); full schema validation lives in ``vega_lite_emitter.py``.

import type {
  ChartPayload,
  ChartPayloadChart,
  ChartPayloadKpi,
  ChartPayloadSummary,
  ChartPayloadTable,
  ChartPayloadEmpty,
  ChartSummaryField,
  ChartTableColumn,
} from './generated/chartContract';
export type {
  ChartPayload,
  ChartPayloadChart,
  ChartPayloadKpi,
  ChartPayloadSummary,
  ChartPayloadTable,
  ChartPayloadEmpty,
  ChartSummaryField,
  ChartTableColumn,
};
export { validateChartPayload } from './generated/chartContract.validator';

// Hand-written string-literal unions — the generated module names these with
// Pydantic ``title`` casing (``ReasonCode``, ``Format``) which would churn
// on schema edits. Keep the stable consumer names here.
export type ChartReasonCode =
  | 'CG_EMPTY'
  | 'CG_SINGLE_VALUE'
  | 'CG_FIELD_CARD'
  | 'CG_NO_MEASURE'
  | 'CG_ALL_IDS'
  | 'CG_DEGENERATE_MEASURE'
  | 'CG_HIGH_CARD'
  | 'CG_EMIT_FAILED';
export type KpiFormat = 'integer' | 'decimal' | 'percent' | 'currency' | 'duration_ms';

export type VegaLiteEncodingType =
  | 'quantitative'
  | 'temporal'
  | 'ordinal'
  | 'nominal'
  | 'geojson';

export interface VegaLiteAxisDef {
  title?: string;
  format?: string;
}

export interface VegaLiteEncodingChannel {
  field?: string;
  type?: VegaLiteEncodingType;
  axis?: VegaLiteAxisDef;
  stack?: 'zero' | 'normalize' | 'center' | null | false;
  legend?: { title?: string } | null;
}

export interface VegaLiteEncoding {
  x?: VegaLiteEncodingChannel;
  y?: VegaLiteEncodingChannel;
  xOffset?: VegaLiteEncodingChannel;
  color?: VegaLiteEncodingChannel;
  theta?: VegaLiteEncodingChannel;
  [channel: string]: VegaLiteEncodingChannel | undefined;
}

export interface VegaLiteFoldTransform {
  fold: string[];
  as?: [string, string];
}

export type VegaLiteMark = 'bar' | 'line' | 'area' | 'arc';

export interface VegaLiteSpec {
  $schema?: string;
  mark: VegaLiteMark;
  encoding?: VegaLiteEncoding;
  transform?: Array<VegaLiteFoldTransform | Record<string, unknown>>;
}

export interface BlueprintSection {
  id: string;
  type: string;
  title: string;
  variant?: string;
}

export interface ComposedReport {
  reportName: string;
  sections: BlueprintSection[];
}

export interface TextPart {
  type: 'text';
  content: string;
}

// Routing telemetry surfaced on the wire so the chip can narrate the
// supervisor → specialist hand-off concretely (e.g. "agg_evaluation_run
// · 16 rows · 56ms" instead of "data_specialist · 0ms"). Mirror of
// ``data_specialist._emit_with_telemetry``'s ``routing_payload``. The
// ``bouncer`` block is set on every workbench-pipeline submit_sql call
// and absent on legacy turns.
export interface BouncerTelemetry {
  status?: 'ok' | 'invalid';
  rule_id?: string;
  diagnostic?: {
    rule_id: string;
    message: string;
    hint?: string;
    offending_tables?: string[];
    offending_columns?: string[];
  };
  declared_grain?: string[];
  expected_row_bound?: string;
  row_cap?: number;
  limit_applied?: number;
  more_rows_exist?: boolean;
  displayed_row_count?: number;
}

export interface SpecialistRoutingTelemetry {
  intentClass?: string;
  allowedLayers?: string[];
  projectedTables?: string[];
  attemptedSql?: string;
  validationResult?: string;
  executionStatus?: string;
  chartPayloadKind?: string | null;
  status?: string;
  latencyMs?: number;
  bouncer?: BouncerTelemetry;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  briefSummary?: string;
  state: 'executing' | 'completed' | 'error';
  summary?: string;
  detail?: ToolCallDetailData | null;
  durationMs?: number;
  // Phase 1A wire additions — the chip uses these to render the
  // "Sherlock consulted the data specialist · …" narrative + metrics.
  rowCount?: number;
  evidenceCount?: number;
  routing?: SpecialistRoutingTelemetry;
}

// Phase 4: ``ChartPart`` wraps a ``ChartPayload`` (discriminated union).
// Save-to-library state stays a sibling of the payload so it doesn't
// conflict with the union's own ``kind`` discriminator.
export interface ChartPart {
  type: 'chart';
  payload: ChartPayload;
  saved?: boolean;
  chartId?: string;
}

export interface BlueprintPart {
  type: 'blueprint';
  name: string;
  sections: BlueprintSection[];
  saved?: boolean;
  blueprintId?: string;
}

export interface SaveToastPart {
  type: 'save-toast';
  variant: SaveVariant;
  title: string;
  subtitle: string;
  linkText?: string;
  linkHref?: string;
}

export interface DashboardBarPart {
  type: 'dashboard-bar';
  charts: ChartPart[];
}

// Phase 7 — async jobs as first-class harness outcomes.
// A ``JobBadgePart`` is emitted for every assistant message that submitted
// a platform job via ``capability_pack.submit_pack_job``. The widget polls
// via ``pollJobUntilComplete`` and transitions the badge through queued /
// running / completed | failed | cancelled without a page reload.
export type JobBadgeStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobBadgePart {
  type: 'job-badge';
  jobId: string;
  jobType?: string;
  status: JobBadgeStatus;
  summary?: string;
  resultHref?: string;
}

export type MessagePart =
  | TextPart
  | ToolCallPart
  | ChartPart
  | BlueprintPart
  | SaveToastPart
  | DashboardBarPart
  | JobBadgePart;

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  reasoningTokens: number;
  toolUsePromptTokens: number;
  totalTokens: number;
  costUsd: number;
  callCount: number;
}

export interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  status: 'pending' | 'streaming' | 'complete' | 'error';
  terminalStatus?: TerminalStatus;
  usage?: TurnUsage;
  /** Human-readable failure reason carried into the chat-thread Error
   *  footer. When set, replaces the generic "Retry the last prompt to
   *  continue." subtitle so the user actually sees what broke. Set by
   *  the runtime applier on `onError` and on hash-mismatch system
   *  messages. Never persisted to the backend. */
  errorReason?: string;
}

export interface ChatDefaults {
  openai: { model: string };
}

export interface BuilderStoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  errorMessage?: string | null;
  metadata?: unknown;
  createdAt: string;
}

export interface BuilderSessionData {
  sessionId: string;
  provider: ChatProvider;
  model: string;
  activeTurnId?: string | null;
  lastEventSeq: number;
  currentTurnStatus: TurnLifecycleStatus;
  messages: BuilderStoredMessage[];
}

export interface RuntimeEventRecord {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface BuilderRuntimeEventsData {
  sessionId: string;
  lastEventSeq: number;
  events: RuntimeEventRecord[];
}

export interface PromptTemplate {
  label: string;
  prompt: string;
  category?: string;
}

export interface ChatWidgetConfig {
  enabled?: boolean;
  promptTemplates?: PromptTemplate[];
  capabilities?: string[];
}

export type WidgetView = 'chat' | 'history';

export interface WidgetSessionSummary {
  id: string;
  title: string;
  updatedAt: Date;
  status: string;
}

// Phase 1 — harness-owned artifact triple. Pack-produced results flow
// through the message metadata and the ``turn_finished`` SSE event as opaque
// ``Artifact`` records. The frontend dispatches on ``packId`` +
// ``contractId`` (e.g. ``analytics.chart.v1``, ``report_builder.blueprint.v1``)
// to render chart / blueprint / future pack outputs uniformly.
export interface Artifact {
  pack_id: string;
  contract_id: string;
  payload: unknown;
  extras?: Record<string, unknown>;
}

// Phase 7 audit fix (Gap 4): ``outcome`` is the §6.2 envelope projection
// the backend emits on specialist_finished / turn_finished. Persisted with each tool
// call so ``partsFromStoredMessage`` can reconstruct a ``JobBadgePart``
// from ``outcome.job`` after reload/replay (Gap 5).
export interface StoredToolCallOutcome {
  kind?: string;
  capability?: string;
  reasonCode?: string | null;
  reason_code?: string | null;
  job?: { id?: string; status?: JobBadgeStatus };
  artifact?: { type?: string; contract?: string; extras?: Record<string, unknown> };
}

export interface StoredWidgetMetadata {
  parts?: MessagePart[];
  toolCalls?: Array<{
    toolCallId?: string;
    name: string;
    summary?: string;
    detail?: ToolCallDetailData | null;
    routing?: SpecialistRoutingTelemetry;
    outcome?: StoredToolCallOutcome;
  }>;
  artifacts?: Artifact[] | null;
  terminalStatus?: TerminalStatus;
}
