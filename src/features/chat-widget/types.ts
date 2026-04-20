import type { ComposedReport } from '@/features/reportBuilder/types';

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

export interface ChartSpec {
  type: string;
  title: string;
  xKey: string;
  yKey?: string;
  seriesKeys: string[];
  series?: SeriesConfig[];
  xLabel: string;
  yLabel: string;
  legendPosition?: 'top' | 'bottom' | 'right' | 'none';
  alternatives?: string[];
}

export interface ChartData {
  spec: ChartSpec;
  data: Record<string, unknown>[];
  sqlQuery: string;
  sourceQuestion: string;
}

// ── Phase 4 chart-contract payload ─────────────────────────────────
// The backend orchestrator (`_build_chart_payload`) emits one of these
// discriminated-union variants via the SSE ``chart`` event and persists
// the same shape in assistant-message metadata + runtime events.
//
// Local minimal Vega-Lite typing — we intentionally do not depend on the
// `vega-lite` npm package for types. The frontend only reads a handful
// of fields (mark, encoding, transform); full schema validation lives
// backend-side in `vega_lite_emitter.py`.

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

interface ChartPayloadBase {
  title?: string;
  source_question?: string;
  sql_query?: string;
  reason_code?: ChartReasonCode | null;
  warning?: string | null;
}

export interface ChartPayloadChart extends ChartPayloadBase {
  kind: 'chart';
  spec: VegaLiteSpec;
  data: Array<Record<string, unknown>>;
}

export interface ChartPayloadKpi extends ChartPayloadBase {
  kind: 'kpi';
  kpi: {
    value: number | string | null;
    label: string;
    format: KpiFormat;
    semantic_type?: string | null;
  };
}

export interface ChartSummaryField {
  name: string;
  label: string;
  value: unknown;
  role: string;
  semantic_type?: string | null;
}

export interface ChartPayloadSummary extends ChartPayloadBase {
  kind: 'summary';
  summary: { fields: ChartSummaryField[] };
}

export interface ChartTableColumn {
  name: string;
  label: string;
  role: string;
  semantic_type?: string | null;
  data_type?: string | null;
}

export interface ChartPayloadTable extends ChartPayloadBase {
  kind: 'table';
  columns: ChartTableColumn[];
  data: Array<Record<string, unknown>>;
}

export interface ChartPayloadEmpty extends ChartPayloadBase {
  kind: 'empty';
}

export type ChartPayload =
  | ChartPayloadChart
  | ChartPayloadKpi
  | ChartPayloadSummary
  | ChartPayloadTable
  | ChartPayloadEmpty;

export interface BlueprintSection {
  id: string;
  type: string;
  title: string;
  variant?: string;
}

export interface TextPart {
  type: 'text';
  content: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  state: 'executing' | 'completed' | 'error';
  summary?: string;
  detail?: ToolCallDetailData | null;
  durationMs?: number;
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

export type MessagePart =
  | TextPart
  | ToolCallPart
  | ChartPart
  | BlueprintPart
  | SaveToastPart
  | DashboardBarPart;

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

export interface StoredWidgetMetadata {
  parts?: MessagePart[];
  toolCalls?: Array<{
    toolCallId?: string;
    name: string;
    summary?: string;
    detail?: ToolCallDetailData | null;
  }>;
  // ``chart`` on the wire is either the new ``ChartPayload`` union or a
  // legacy pre-contract ``ChartData`` record. The session-replay path
  // runs it through ``normalizeLegacyChartPayload`` before use.
  chart?: ChartPayload | ChartData | null;
  blueprint?: BlueprintPart | null;
  composedReport?: ComposedReport | null;
  terminalStatus?: TerminalStatus;
}
