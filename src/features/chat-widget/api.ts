import { apiRequest } from '@/services/api/client';
import { useAuthStore } from '@/stores/authStore';
import { logger } from '@/services/logger/logger';
import type {
  Artifact,
  BlueprintPart,
  BuilderSessionData,
  ChatDefaults,
  ChartPayload,
  RuntimeOperation,
  SaveVariant,
  TerminalStatus,
  ToolCallDetailData,
  TurnUsage,
} from './types';

interface ChatRequest {
  appId: string;
  sessionId: string | null;
  turnId: string;
  operation: RuntimeOperation;
  message?: string;
  model: string;
}

interface CancelTurnResponse {
  sessionId: string;
  turnId: string;
  result: 'cancelled' | 'forced_interrupted' | 'already_terminal';
  turnStatus: string;
  message: string;
}

interface StreamSessionEvent {
  sessionId: string;
  provider: BuilderSessionData['provider'];
  model: string;
  lastEventSeq?: number;
}

interface StreamToolCallStartEvent {
  seq: number;
  toolCallId: string;
  toolName: string;
}

// Phase 7 audit fix (Gap 4): ``outcome`` is the §6.2 envelope projection
// the backend emits on specialist_finished / turn_finished. Carrying ``job`` end-to-end
// lets the widget render a live pending-job badge (Gap 5).
interface StreamToolCallOutcome {
  kind?: string;
  capability?: string;
  reason_code?: string | null;
  job?: { id?: string; status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' };
  artifact?: { type?: string; contract?: string; extras?: Record<string, unknown> };
}

interface StreamToolCallEndEvent extends StreamToolCallStartEvent {
  summary?: string;
  detail?: ToolCallDetailData | null;
  durationMs?: number;
  outcome?: StreamToolCallOutcome;
}

interface StreamDoneEvent {
  seq: number;
  terminalStatus?: TerminalStatus;
  content?: string;
  warnings?: string[];
  toolCalls: Array<{
    toolCallId?: string;
    name: string;
    summary?: string;
    detail?: ToolCallDetailData | null;
    outcome?: StreamToolCallOutcome;
  }>;
  // Phase 1 — pack-produced results arrive as opaque ``Artifact`` triples
  // (``{pack_id, contract_id, payload, extras?}``). The frontend dispatches
  // on ``pack_id`` + ``contract_id`` to render analytics charts,
  // report-builder blueprints, and any future pack outputs uniformly.
  artifacts?: Artifact[] | null;
  // Optional token + cost summary aggregated server-side from the turn's
  // llm_usage rows (Phase 2 backend). Absent when no rows were recorded —
  // consumers must handle absence without layout shift.
  usage?: TurnUsage;
}

interface StreamStatusEvent {
  seq?: number;
  text: string;
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

function normalizeTurnUsage(raw: unknown): TurnUsage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const usage = raw as Record<string, unknown>;
  const numberValue = (camel: string, snake: string): number => {
    const value = usage[camel] ?? usage[snake];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  const inputTokens = numberValue('inputTokens', 'input_tokens');
  const outputTokens = numberValue('outputTokens', 'output_tokens');
  const cachedReadTokens = numberValue('cachedReadTokens', 'cached_read_tokens');
  const cachedWriteTokens = numberValue('cachedWriteTokens', 'cached_write_tokens');
  const reasoningTokens = numberValue('reasoningTokens', 'reasoning_tokens');
  const toolUsePromptTokens = numberValue('toolUsePromptTokens', 'tool_use_prompt_tokens');
  const totalTokens = numberValue('totalTokens', 'total_tokens')
    || inputTokens + outputTokens + cachedReadTokens + cachedWriteTokens + reasoningTokens + toolUsePromptTokens;
  return {
    inputTokens,
    outputTokens,
    cachedReadTokens,
    cachedWriteTokens,
    reasoningTokens,
    toolUsePromptTokens,
    totalTokens,
    costUsd: numberValue('costUsd', 'cost_usd'),
    callCount: numberValue('callCount', 'call_count'),
  };
}

function normalizeTerminalStatus(raw: unknown): TerminalStatus {
  const value = typeof raw === 'string' ? raw : 'done';
  if (value === 'partial' || value === 'degraded') return 'degraded';
  if (value === 'failed' || value === 'error') return 'error';
  if (value === 'interrupted') return 'interrupted';
  return 'done';
}

export async function getBuilderSession(appId: string, sessionId: string): Promise<BuilderSessionData> {
  return apiRequest<BuilderSessionData>(`/api/report-builder/v2/sessions/${sessionId}?app_id=${encodeURIComponent(appId)}`);
}

export async function getChatDefaults(): Promise<ChatDefaults> {
  return apiRequest<ChatDefaults>('/api/chat-engine/defaults');
}

export async function cancelChatTurn(
  appId: string,
  sessionId: string,
  turnId: string,
): Promise<CancelTurnResponse> {
  return apiRequest<CancelTurnResponse>(
    `/api/report-builder/v2/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel?app_id=${encodeURIComponent(appId)}`,
    { method: 'POST' },
  );
}

export async function streamChatMessage(
  body: ChatRequest,
  callbacks: {
    onSessionId: (session: StreamSessionEvent) => void;
    onEntityRecognition: (event: EntityRecognitionEvent) => void;
    onToolCallStart: (event: StreamToolCallStartEvent) => void;
    onToolCallEnd: (event: StreamToolCallEndEvent) => void;
    onContentDelta: (event: { seq: number; delta: string }) => void;
    onChart: (event: { seq: number; payload: ChartPayload; saved?: boolean; chartId?: string }) => void;
    onBlueprint: (event: BlueprintPart & { seq: number }) => void;
    onSaveResult: (event: SaveResultEvent) => void;
    onStatus: (event: StreamStatusEvent) => void;
    onDone: (data: StreamDoneEvent) => void;
    onError: (error: StreamErrorEvent) => void;
  },
): Promise<AbortController> {
  const controller = new AbortController();

  const doFetch = () =>
    fetch('/api/report-builder/v2/chat/stream', {
      method: 'POST',
      headers: getStreamHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'include',
    });

  (async () => {
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

      let response: Response;
      try {
        response = await doFetch();
        if (response.status === 401) {
          const refreshed = await useAuthStore.getState().refreshToken();
          if (!refreshed) {
            useAuthStore.getState().logout();
            emitError({ message: 'Session expired', terminalStatus: 'error' });
            return;
          }
          response = await doFetch();
          if (response.status === 401) {
            useAuthStore.getState().logout();
            emitError({ message: 'Session expired', terminalStatus: 'error' });
            return;
          }
        }
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          return;
        }
        emitError({
          message: error instanceof Error ? error.message : String(error),
          terminalStatus: 'error',
        });
        return;
      }

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

          // Sherlock v3 wire vocabulary. Names align 1:1 with the
          // backend event names emitted by sherlock_v3.runtime +
          // sherlock_v3.turn_orchestrator. No translation layer.
          switch (eventType) {
            case 'session':
              callbacks.onSessionId(data as unknown as StreamSessionEvent);
              break;
            case 'specialist_started': {
              const seq = typeof data.seq === 'number' ? data.seq : 0;
              callbacks.onToolCallStart({
                seq,
                toolCallId: String(data.call_id ?? `tc_${seq}`),
                toolName: String(data.specialist ?? 'specialist'),
              });
              break;
            }
            case 'specialist_finished': {
              const seq = typeof data.seq === 'number' ? data.seq : 0;
              callbacks.onToolCallEnd({
                seq,
                toolCallId: String(data.call_id ?? ''),
                toolName: String(data.specialist ?? 'specialist'),
                summary: typeof data.result_summary === 'string' ? data.result_summary : '',
                durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : 0,
                outcome: {
                  kind: typeof data.status === 'string' ? data.status : 'ok',
                  capability: typeof data.specialist === 'string' ? data.specialist : '',
                },
              });
              break;
            }
            case 'content_delta': {
              const text = typeof data.text === 'string' ? data.text : '';
              const phase = typeof data.phase === 'string' ? data.phase : 'final_answer';
              if (!text) break;
              const seq = typeof data.seq === 'number' ? data.seq : 0;
              if (phase === 'commentary') {
                callbacks.onStatus({ seq, text });
              } else {
                accumulatedContent += text;
                callbacks.onContentDelta({ seq, delta: text });
              }
              break;
            }
            case 'artifact_emitted': {
              const seq = typeof data.seq === 'number' ? data.seq : 0;
              const payload = (data.payload ?? {}) as Record<string, unknown>;
              callbacks.onChart({ seq, payload: payload as unknown as ChartPayload });
              break;
            }
            case 'turn_finished': {
              terminalReceived = true;
              const seq = typeof data.seq === 'number' ? data.seq : 0;
              const terminalStatus = normalizeTerminalStatus(data.status);
              const usage = normalizeTurnUsage(data.usage);
              const artifacts = Array.isArray(data.artifacts) ? data.artifacts as Artifact[] : null;
              const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls as StreamDoneEvent['toolCalls'] : [];
              const content = typeof data.content === 'string' ? data.content : accumulatedContent;
              callbacks.onDone({
                seq,
                terminalStatus,
                content,
                warnings: [],
                toolCalls,
                artifacts,
                ...(usage ? { usage } : {}),
              });
              break;
            }
            case 'error_emitted': {
              terminalReceived = true;
              const errorStatus = normalizeTerminalStatus(data.status);
              callbacks.onError({
                message: String(data.message ?? 'Unknown error'),
                terminalStatus: errorStatus === 'interrupted' ? 'interrupted' : 'error',
                seq: typeof data.seq === 'number' ? data.seq : undefined,
                content: (typeof data.content === 'string' ? data.content : accumulatedContent) || undefined,
              });
              break;
            }
            default:
              logger.debug('Ignoring unknown Sherlock SSE event', { eventType });
              break;
          }

          eventType = '';
        }
      }
    })()
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
