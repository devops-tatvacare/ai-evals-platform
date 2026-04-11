import type { ComposedReport } from '@/features/reportBuilder/types';

export type ChatProvider = 'gemini' | 'openai';

export interface ToolCallDetailData {
  executionMs: number;
  sqlUsed?: string | null;
  rowCount?: number | null;
  cacheHit?: boolean | null;
  error?: string | null;
}

export interface ToolCallBadgeData {
  name: string;
  summary?: string;
  detail?: ToolCallDetailData | null;
  status: 'running' | 'done';
}

export interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallBadgeData[];
  composedReport?: ComposedReport | null;
  status: 'complete' | 'streaming' | 'error';
}

export interface ChatDefaults {
  gemini: { model: string };
  openai: { model: string };
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
