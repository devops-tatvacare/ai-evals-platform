import { apiRequest } from '@/services/api/client';
import type { BuilderSessionData, ChatDefaults } from './types';
import type { ComposedReport } from '@/features/reportBuilder/types';
import type { ToolCallDetailData, ChartData } from './types';

interface ChatRequest {
  appId: string;
  sessionId: string | null;
  message: string;
  provider: string;
  model: string;
}

interface ChatResponse {
  sessionId: string;
  provider?: string | null;
  model?: string | null;
  role: string;
  content: string;
  toolCalls: Array<{ name: string; summary: string; detail?: ToolCallDetailData | null }>;
  composedReport: ComposedReport | null;
  chart: ChartData | null;
}

export async function sendChatMessage(body: ChatRequest): Promise<ChatResponse> {
  return apiRequest<ChatResponse>('/api/report-builder/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getBuilderSession(appId: string, sessionId: string): Promise<BuilderSessionData> {
  return apiRequest<BuilderSessionData>(`/api/report-builder/sessions/${sessionId}?app_id=${encodeURIComponent(appId)}`);
}

export async function getChatDefaults(): Promise<ChatDefaults> {
  return apiRequest<ChatDefaults>('/api/chat-engine/defaults');
}

export async function streamChatMessage(
  body: ChatRequest,
  callbacks: {
    onSessionId: (session: BuilderSessionData) => void;
    onToolCallStart: (name: string) => void;
    onToolCallEnd: (name: string, summary: string, detail?: ToolCallDetailData | null) => void;
    onContentDelta: (delta: string) => void;
    onChart: (chart: ChartData) => void;
    onDone: (data: { toolCalls: Array<{ name: string; summary: string; detail?: ToolCallDetailData | null }>; composedReport: ComposedReport | null }) => void;
    onError: (error: string) => void;
  },
): Promise<AbortController> {
  const controller = new AbortController();
  const token = localStorage.getItem('accessToken') || '';

  fetch('/api/report-builder/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        callbacks.onError(`API error ${res.status}`);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { callbacks.onError('No response body'); return; }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            try {
            const data = JSON.parse(raw);
              if (eventType === 'session') callbacks.onSessionId(data);
              else if (eventType === 'tool_call_start') callbacks.onToolCallStart(data.name);
              else if (eventType === 'tool_call_end') callbacks.onToolCallEnd(data.name, data.summary, data.detail);
              else if (eventType === 'content_delta') callbacks.onContentDelta(data.delta);
              else if (eventType === 'chart') callbacks.onChart(data as ChartData);
              else if (eventType === 'done') callbacks.onDone(data);
              else if (eventType === 'error') callbacks.onError(data.message || 'Unknown error');
            } catch { /* skip malformed */ }
            eventType = '';
          }
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError') callbacks.onError(String(err));
    });

  return controller;
}
