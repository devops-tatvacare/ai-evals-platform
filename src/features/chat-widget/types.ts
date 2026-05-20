export type ChatProvider = 'openai';
export type TerminalStatus = 'done' | 'error' | 'interrupted' | 'degraded';
export type TurnLifecycleStatus = 'queued' | 'active' | 'done' | 'degraded' | 'error' | 'interrupted';
export type SaveVariant = 'chart' | 'dashboard' | 'blueprint';

export interface SeriesConfig {
  dataKey: string;
  type: 'bar' | 'line' | 'area' | 'scatter';
  stackId?: string;
}

// Chart-payload types are codegen'd from the backend Pydantic ChartPayload
// model (npm run codegen:chart-contract). The ajv validator ships alongside.
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

// Stable consumer-facing names for unions the generator titles differently.
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

export interface ChartPart {
  type: 'chart';
  payload: ChartPayload;
  saved?: boolean;
  chartId?: string;
}

export interface SaveToastPart {
  type: 'save-toast';
  variant: SaveVariant;
  title: string;
  subtitle: string;
  linkText?: string;
  linkHref?: string;
}

// Full-width separator the widget renders when the Responses API compacts
// earlier turns; tokensBefore is the SDK's pre-compaction estimate, nullable.
export interface CompactionPart {
  type: 'compaction';
  summary: string;
  tokensBefore: number | null;
  occurredAt: string;
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

export interface PromptTemplate {
  label: string;
  prompt: string;
  category?: string;
}

export type WidgetView = 'chat' | 'history';

export interface WidgetSessionSummary {
  id: string;
  title: string;
  updatedAt: Date;
  status: string;
}
