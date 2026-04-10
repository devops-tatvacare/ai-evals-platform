import { apiRequest } from '@/services/api/client';
import type { ChatDefaults } from './types';
import type { ComposedReport } from '@/features/reportBuilder/types';

interface ChatRequest {
  appId: string;
  sessionId: string | null;
  message: string;
  provider: string;
  model: string;
}

interface ChatResponse {
  sessionId: string;
  role: string;
  content: string;
  toolCalls: Array<{ name: string; summary: string }>;
  composedReport: ComposedReport | null;
}

export async function sendChatMessage(body: ChatRequest): Promise<ChatResponse> {
  return apiRequest<ChatResponse>('/api/report-builder/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getChatDefaults(): Promise<ChatDefaults> {
  return apiRequest<ChatDefaults>('/api/chat-engine/defaults');
}

export async function streamChatMessage(
  body: ChatRequest,
  callbacks: {
    onSessionId: (sessionId: string) => void;
    onToolCallStart: (name: string) => void;
    onToolCallEnd: (name: string, summary: string) => void;
    onContentDelta: (delta: string) => void;
    onDone: (data: { toolCalls: Array<{ name: string; summary: string }>; composedReport: ComposedReport | null }) => void;
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
              if (eventType === 'session') callbacks.onSessionId(data.sessionId);
              else if (eventType === 'tool_call_start') callbacks.onToolCallStart(data.name);
              else if (eventType === 'tool_call_end') callbacks.onToolCallEnd(data.name, data.summary);
              else if (eventType === 'content_delta') callbacks.onContentDelta(data.delta);
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
