/** Sherlock Part stream client — one POST per turn. */
// EventSource cannot carry a Bearer header, so we use fetch + ReadableStream.
import type { QueryClient } from '@tanstack/react-query';

import { logger } from '@/services/logger';
import { useAuthStore } from '@/stores/authStore';

import { validateSherlockPart } from './generated/sherlockContract.validator';
import {
  useStreamStore,
  type StreamEvent,
} from './streamStore';

export type TerminalStatus = 'done' | 'degraded' | 'error' | 'interrupted';

export interface TurnTerminal {
  status: TerminalStatus;
  lastError: string | null;
}

export interface StreamSession {
  sessionId: string;
  provider: string;
  model: string;
}

export interface StreamTurnOptions {
  appId: string;
  /** Null when starting a brand-new conversation; the backend will mint one and
   *  echo it on the `session` frame. */
  sessionId: string | null;
  turnId: string;
  /** Required for `operation: 'send'`; must be absent for `operation: 'resume'`. */
  message?: string;
  model: string;
  provider?: string;
  operation?: 'send' | 'resume';
  resumeFromSeq?: number;
  queryClient: QueryClient;
  /** Fires once with the backend-resolved session metadata (always before any
   *  Part frame). The orchestrator uses it to commit the new sessionId. */
  onSession?(session: StreamSession): void;
  /** Optional terminal callback for the host (status pill, error toast, etc.). */
  onTerminal?(payload: TurnTerminal): void;
}

export interface TurnStreamControls {
  abort(): void;
  done: Promise<TurnTerminal>;
}

/**
 * POST one turn to the chat/stream SSE endpoint and pipe every accepted
 * Part into the streamStore. Resolves once the stream emits its
 * `turn_terminal` frame or aborts.
 */
export function streamTurn(options: StreamTurnOptions): TurnStreamControls {
  const controller = new AbortController();
  let resolved = false;
  let terminal: TurnTerminal | null = null;
  let resolveDone: (t: TurnTerminal) => void = () => {};
  let rejectDone: (err: unknown) => void = () => {};
  const done = new Promise<TurnTerminal>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  let resolvedSessionId: string | null = options.sessionId;
  const pendingFrames: string[] = [];

  const invalidateSnapshot = () => {
    if (!resolvedSessionId) return;
    // Match by session prefix so the appId-suffixed key still invalidates.
    void options.queryClient.invalidateQueries({
      queryKey: ['sherlock', 'session-parts', resolvedSessionId],
    });
  };

  const setStatus = useStreamStore.getState().setStatus;
  setStatus('streaming');

  const eventNameOf = (frame: string): string => {
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) return line.slice(6).trim();
    }
    return 'message';
  };

  const dispatchFrame = (frame: string) => {
    handleFrame({
      frame,
      sessionId: resolvedSessionId ?? '',
      invalidateSnapshot,
      onTerminal: finalize,
      onSession: (session) => {
        const isFirstSession = !resolvedSessionId;
        resolvedSessionId = session.sessionId;
        options.onSession?.(session);
        if (!isFirstSession) return;
        // Drain frames received before the session frame arrived.
        const queued = pendingFrames.splice(0);
        for (const queuedFrame of queued) dispatchFrame(queuedFrame);
      },
    });
  };

  const drainFrame = (frame: string) => {
    // Always process session/turn_terminal so we never buffer the very frame
    // that mints the sessionId — buffering only applies to part_added/_updated
    // which need a resolved sessionId.
    const ev = eventNameOf(frame);
    if (ev === 'session' || ev === 'turn_terminal') {
      dispatchFrame(frame);
      return;
    }
    if (!resolvedSessionId) {
      pendingFrames.push(frame);
      return;
    }
    dispatchFrame(frame);
  };

  const finalize = (payload: TurnTerminal) => {
    if (resolved) return;
    resolved = true;
    terminal = payload;
    setStatus(payload.status === 'error' ? 'error' : 'idle');
    options.onTerminal?.(payload);
    resolveDone(payload);
  };

  void (async () => {
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      finalize({ status: 'error', lastError: 'No active session' });
      return;
    }
    const body = {
      appId: options.appId,
      sessionId: options.sessionId,
      turnId: options.turnId,
      operation: options.operation ?? 'send',
      message: options.message ?? null,
      model: options.model,
      provider: options.provider ?? null,
      resumeFromSeq: options.resumeFromSeq ?? null,
    };

    let resp: Response;
    try {
      resp = await fetch('/api/report-builder/v2/chat/stream', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        finalize({ status: 'interrupted', lastError: null });
        return;
      }
      logger.warn('sherlock streamTurn fetch failed', { err: String(err) });
      finalize({ status: 'error', lastError: 'Network error while streaming the turn.' });
      return;
    }

    if (!resp.ok || !resp.body) {
      finalize({
        status: 'error',
        lastError: `Server returned ${resp.status} starting the turn stream.`,
      });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!controller.signal.aborted) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          drainFrame(frame);
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!resolved) {
        if (controller.signal.aborted) {
          finalize({ status: 'interrupted', lastError: null });
        } else {
          finalize({
            status: 'error',
            lastError: 'Sherlock stopped responding mid-answer. Try sending your question again.',
          });
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        finalize({ status: 'interrupted', lastError: null });
        return;
      }
      logger.warn('sherlock streamTurn read failed', { err: String(err) });
      finalize({ status: 'error', lastError: 'Lost connection to Sherlock. Refresh and try again.' });
    }
  })();

  void terminal;
  void rejectDone;
  return {
    abort() {
      controller.abort();
      if (!resolved) {
        finalize({ status: 'interrupted', lastError: null });
      }
    },
    done,
  };
}

interface HandleFrameArgs {
  frame: string;
  sessionId: string;
  invalidateSnapshot(): void;
  onTerminal(payload: TurnTerminal): void;
  onSession?(session: StreamSession): void;
}

export function handleFrame({
  frame,
  sessionId,
  invalidateSnapshot,
  onTerminal,
  onSession,
}: HandleFrameArgs): void {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch (err) {
    logger.warn('sherlock SSE: malformed JSON frame', { err: String(err), eventName });
    invalidateSnapshot();
    return;
  }

  if (eventName === 'turn_terminal') {
    const term = readTerminal(payload);
    if (term) onTerminal(term);
    return;
  }
  if (eventName === 'session') {
    const session = readSession(payload);
    if (session) onSession?.(session);
    return;
  }
  if (eventName !== 'part_added' && eventName !== 'part_updated') {
    logger.debug('sherlock SSE: ignoring unknown event', { eventName });
    return;
  }
  if (!isPartFramePayload(payload)) {
    logger.warn('sherlock SSE: payload missing seq/part', { eventName });
    invalidateSnapshot();
    return;
  }
  if (!validateSherlockPart(payload.part)) {
    logger.warn('sherlock SSE: part failed ajv validation', {
      eventName,
      seq: payload.seq,
    });
    invalidateSnapshot();
    return;
  }
  const streamEvent: StreamEvent = {
    kind: eventName,
    seq: payload.seq,
    part: payload.part,
  };
  useStreamStore.getState().applyEvent(sessionId, streamEvent);
  if (useStreamStore.getState().hasGapBySession[sessionId]) {
    invalidateSnapshot();
  }
}

function isPartFramePayload(
  value: unknown,
): value is { seq: number; part: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.seq === 'number' &&
    typeof v.part === 'object' &&
    v.part !== null
  );
}

function readSession(value: unknown): StreamSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const sessionId = typeof v.sessionId === 'string' ? v.sessionId : null;
  if (!sessionId) return null;
  return {
    sessionId,
    provider: typeof v.provider === 'string' ? v.provider : 'openai',
    model: typeof v.model === 'string' ? v.model : '',
  };
}

function readTerminal(value: unknown): TurnTerminal | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const rawStatus = v.status;
  const status: TerminalStatus | null =
    rawStatus === 'done'
      || rawStatus === 'degraded'
      || rawStatus === 'error'
      || rawStatus === 'interrupted'
      ? rawStatus
      : rawStatus === 'failed'
        ? 'error'
        : null;
  if (!status) return null;
  // Backend wire is snake_case (`last_error`); accept camelCase too for forward
  // compatibility with any caller still using the old key.
  const candidate = v.last_error ?? v.lastError;
  const lastError = typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  return { status, lastError };
}
