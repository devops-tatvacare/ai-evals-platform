/**
 * Sherlock Part stream SSE client.
 *
 * Single subscription per session: opens /api/sherlock/sessions/:id/stream,
 * parses the {kind, seq, part} envelope, validates each Part against the
 * generated ajv schema, and dispatches to streamStore. On parse failure or
 * sequence gap it asks TanStack Query to invalidate the snapshot so the
 * store re-seeds from the next snapshot fetch.
 *
 * Why fetch + ReadableStream rather than EventSource: EventSource cannot
 * carry a Bearer header (browser API gap), and our auth model is
 * Authorization-header-only. Same constraint useRunStream solves the same way.
 */
import type { QueryClient } from '@tanstack/react-query';

import { logger } from '@/services/logger';
import { useAuthStore } from '@/stores/authStore';

import { validateSherlockPart } from './generated/sherlockContract.validator';
import { sherlockPartsQueryKeys } from './queries/parts';
import {
  useStreamStore,
  type StreamEvent,
} from './streamStore';

type StreamControls = {
  close(): void;
};

interface OpenOptions {
  sessionId: string;
  queryClient: QueryClient;
}

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];

export function openSherlockStream({
  sessionId,
  queryClient,
}: OpenOptions): StreamControls {
  let cancelled = false;
  let abort: AbortController | null = null;
  let reconnectTimer: number | null = null;
  let attempt = 0;

  const setStatus = useStreamStore.getState().setStatus;

  const clearTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (cancelled) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
    attempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void pump();
    }, delay);
  };

  const invalidateSnapshot = () => {
    void queryClient.invalidateQueries({
      queryKey: sherlockPartsQueryKeys.sessionParts(sessionId),
    });
  };

  const pump = async (): Promise<void> => {
    if (cancelled) return;
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      setStatus('error');
      return;
    }
    abort?.abort();
    abort = new AbortController();
    setStatus('streaming');

    try {
      const resp = await fetch(
        `/api/sherlock/sessions/${encodeURIComponent(sessionId)}/stream`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          signal: abort.signal,
        },
      );
      if (!resp.ok || !resp.body) {
        setStatus('error');
        scheduleReconnect();
        return;
      }
      attempt = 0;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleFrame(sessionId, frame, invalidateSnapshot);
          boundary = buffer.indexOf('\n\n');
        }
      }
      if (!cancelled) scheduleReconnect();
    } catch (err) {
      if (cancelled || abort?.signal.aborted) return;
      logger.warn('sherlock SSE stream failed', { err: String(err) });
      setStatus('error');
      scheduleReconnect();
    }
  };

  void pump();

  return {
    close() {
      cancelled = true;
      clearTimer();
      abort?.abort();
      setStatus('idle');
    },
  };
}

export function handleFrame(
  sessionId: string,
  frame: string,
  onSnapshotInvalidate: () => void,
): void {
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch (err) {
    logger.warn('sherlock SSE: malformed JSON frame', { err: String(err) });
    onSnapshotInvalidate();
    return;
  }
  if (!isStreamEvent(payload)) {
    logger.warn('sherlock SSE: payload missing kind/seq/part', { payload });
    onSnapshotInvalidate();
    return;
  }
  if (!validateSherlockPart(payload.part)) {
    logger.warn('sherlock SSE: part failed ajv validation', {
      kind: payload.kind,
      seq: payload.seq,
    });
    onSnapshotInvalidate();
    return;
  }
  useStreamStore.getState().applyEvent(sessionId, payload);
  if (useStreamStore.getState().hasGapBySession[sessionId]) {
    onSnapshotInvalidate();
  }
}

function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === 'part_added' || v.kind === 'part_updated') &&
    typeof v.seq === 'number' &&
    typeof v.part === 'object' &&
    v.part !== null
  );
}
