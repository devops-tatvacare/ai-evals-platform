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

export interface ChartPart extends ChartData {
  type: 'chart';
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
  linkText: string;
  linkHref: string;
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

export interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  status: 'pending' | 'streaming' | 'complete' | 'error';
  terminalStatus?: TerminalStatus;
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
  chart?: ChartData | null;
  blueprint?: BlueprintPart | null;
  composedReport?: ComposedReport | null;
  terminalStatus?: TerminalStatus;
}
