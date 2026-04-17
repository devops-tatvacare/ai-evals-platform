import { apiRequest } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { logger } from '@/services/logger/logger';
import type {
  BlueprintPart,
  BuilderRuntimeEventsData,
  BuilderSessionData,
  ChatDefaults,
  ChartData,
  RuntimeOperation,
  SaveVariant,
  TerminalStatus,
  ToolCallDetailData,
} from './types';

interface ChatRequest {
  appId: string;
  sessionId: string | null;
  turnId: string;
  operation: RuntimeOperation;
  resumeFromSeq?: number;
  message?: string;
  provider: string;
  model: string;
}

interface StreamToolCallStartEvent {
  seq: number;
  toolCallId: string;
  toolName: string;
}

interface StreamToolCallEndEvent extends StreamToolCallStartEvent {
  summary?: string;
  detail?: ToolCallDetailData | null;
  durationMs?: number;
}

interface StreamDoneEvent {
  seq: number;
  terminalStatus?: TerminalStatus;
  content?: string;
  warnings?: string[];
  toolCalls: Array<{ toolCallId?: string; name: string; summary?: string; detail?: ToolCallDetailData | null }>;
  chart?: ChartData | null;
  blueprint?: Omit<BlueprintPart, 'type'> | null;
}

interface StreamErrorEvent {
  seq?: number;
  terminalStatus?: Extract<TerminalStatus, 'error' | 'interrupted'>;
  message: string;
  content?: string;
}

interface EntityRecognitionEvent {
  seq: number;
  entities?: Array<{ text: string; type: string; confidence?: number }>;
  isPlatformQuery?: boolean;
  needsResolution?: boolean;
}

interface SaveResultEvent {
  seq: number;
  variant: SaveVariant;
  id: string;
  title: string;
  subtitle?: string;
  linkText?: string;
  linkHref: string;
}

function getStreamHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken ?? localStorage.getItem('accessToken') ?? '';
  return token
    ? {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    : { 'Content-Type': 'application/json' };
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) {
      return `API error ${response.status}`;
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    return String(parsed.error ?? parsed.detail ?? parsed.message ?? `API error ${response.status}`);
  } catch {
    return `API error ${response.status}`;
  }
}

export async function getBuilderSession(appId: string, sessionId: string): Promise<BuilderSessionData> {
  return apiRequest<BuilderSessionData>(`/api/report-builder/v2/sessions/${sessionId}?app_id=${encodeURIComponent(appId)}`);
}

export async function getChatDefaults(): Promise<ChatDefaults> {
  return apiRequest<ChatDefaults>('/api/chat-engine/defaults');
}

export async function getBuilderRuntimeEvents(appId: string, sessionId: string, afterSeq: number): Promise<BuilderRuntimeEventsData> {
  return apiRequest<BuilderRuntimeEventsData>(
    `/api/report-builder/v2/sessions/${sessionId}/events?app_id=${encodeURIComponent(appId)}&after_seq=${afterSeq}`,
  );
}

export async function streamChatMessage(
  body: ChatRequest,
  callbacks: {
    onSessionId: (session: Pick<BuilderSessionData, 'sessionId' | 'provider' | 'model' | 'lastEventSeq'>) => void;
    onEntityRecognition: (event: EntityRecognitionEvent) => void;
    onToolCallStart: (event: StreamToolCallStartEvent) => void;
    onToolCallEnd: (event: StreamToolCallEndEvent) => void;
    onContentDelta: (event: { seq: number; delta: string }) => void;
    onChart: (event: ChartData & { seq: number }) => void;
    onBlueprint: (event: BlueprintPart & { seq: number }) => void;
    onSaveResult: (event: SaveResultEvent) => void;
    onDone: (data: StreamDoneEvent) => void;
    onError: (error: StreamErrorEvent) => void;
  },
): Promise<AbortController> {
  const controller = new AbortController();

  fetch('/api/report-builder/v2/chat/stream', {
    method: 'POST',
    headers: getStreamHeaders(),
    body: JSON.stringify(body),
    signal: controller.signal,
    credentials: 'include',
  })
    .then(async (response) => {
      let terminalReceived = false;
      let accumulatedContent = '';
      let malformedCount = 0;

      const emitError = (error: StreamErrorEvent) => {
        if (terminalReceived) {
          return;
        }
        terminalReceived = true;
        callbacks.onError(error);
      };

      if (!response.ok) {
        emitError({
          message: await parseErrorBody(response),
          terminalStatus: 'error',
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        emitError({ message: 'No response body', terminalStatus: 'error' });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let eventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!terminalReceived) {
            emitError({
              message: 'Stream ended before a terminal runtime event was received',
              terminalStatus: 'error',
              content: accumulatedContent || undefined,
            });
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            eventType = '';
            continue;
          }

          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith('data: ')) {
            continue;
          }

          const raw = line.slice(6);
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            malformedCount += 1;
            logger.warn('Malformed Sherlock SSE payload', { eventType, malformedCount, raw });
            if (malformedCount > 3) {
              emitError({
                message: 'Malformed SSE payload threshold exceeded',
                terminalStatus: 'error',
                content: accumulatedContent || undefined,
              });
              return;
            }
            continue;
          }

          switch (eventType) {
            case 'session':
              callbacks.onSessionId(data as Pick<BuilderSessionData, 'sessionId' | 'provider' | 'model' | 'lastEventSeq'>);
              break;
            case 'entity_recognition':
              callbacks.onEntityRecognition(data as unknown as EntityRecognitionEvent);
              break;
            case 'tool_call_start':
              callbacks.onToolCallStart(data as unknown as StreamToolCallStartEvent);
              break;
            case 'tool_call_end':
              callbacks.onToolCallEnd(data as unknown as StreamToolCallEndEvent);
              break;
            case 'content_delta':
              if (typeof data.delta === 'string') {
                accumulatedContent += data.delta;
              }
              callbacks.onContentDelta(data as { seq: number; delta: string });
              break;
            case 'chart':
              callbacks.onChart(data as unknown as ChartData & { seq: number });
              break;
            case 'done':
              terminalReceived = true;
              callbacks.onDone(data as unknown as StreamDoneEvent);
              break;
            case 'error':
              terminalReceived = true;
              callbacks.onError({
                message: String(data.message ?? 'Unknown error'),
                terminalStatus: (data.terminalStatus as StreamErrorEvent['terminalStatus']) ?? 'error',
                seq: typeof data.seq === 'number' ? data.seq : undefined,
                content: accumulatedContent || undefined,
              });
              break;
            default:
              logger.debug('Ignoring unknown Sherlock SSE event', { eventType });
              break;
          }

          eventType = '';
        }
      }
    })
    .catch((error: unknown) => {
      if ((error as { name?: string }).name === 'AbortError') {
        return;
      }
      callbacks.onError({
        message: error instanceof Error ? error.message : String(error),
        terminalStatus: 'error',
      });
    });

  return controller;
}
