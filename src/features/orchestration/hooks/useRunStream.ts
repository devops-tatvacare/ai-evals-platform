import { useEffect } from 'react';

import { getRunOverlaySnapshot } from '@/services/api/orchestration';
import { useAuthStore } from '@/stores/authStore';
import { useRunOverlayStore } from '@/features/orchestration/store/runOverlayStore';
import { isRunActive } from '@/features/orchestration/types';
import { logger } from '@/services/logger';

/**
 * Subscribe to /api/orchestration/runs/:id/stream while the consumer is
 * mounted; tear down on unmount.
 *
 * Why fetch + ReadableStream rather than EventSource: EventSource cannot
 * carry a Bearer header (browser API gap), and our auth model is
 * Authorization-header-only — cookies are not the source of truth. The SSE
 * wire format is just `event:` + `data:` lines, easy enough to parse here.
 */
export function useRunStream(runId: string | undefined): void {
  useEffect(() => {
    if (!runId) {
      useRunOverlayStore.getState().reset();
      return;
    }
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      useRunOverlayStore.getState().reset();
      return;
    }

    const store = useRunOverlayStore.getState();
    store.activateRun(runId);

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let abort: AbortController | null = null;

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const setStreamStatus = (status: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error') => {
      useRunOverlayStore.getState().setStreamStatus(runId, status);
    };

    const hydrateSnapshot = async (): Promise<void> => {
      const snapshot = await getRunOverlaySnapshot(runId);
      if (cancelled) return;
      useRunOverlayStore.getState().hydrateSnapshot(runId, snapshot);
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const current = useRunOverlayStore.getState();
      if (current.runId !== runId || !isRunActive(current.runStatus)) {
        setStreamStatus('closed');
        return;
      }
      const delay = Math.min(1000 * 2 ** reconnectAttempt, 10000);
      reconnectAttempt += 1;
      setStreamStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void syncAndPump();
      }, delay);
    };

    const pump = async () => {
      abort?.abort();
      abort = new AbortController();
      try {
        await hydrateSnapshot();
        if (cancelled) return;
        const currentState = useRunOverlayStore.getState();
        if (currentState.runId !== runId) return;
        if (!isRunActive(currentState.runStatus)) {
          setStreamStatus('closed');
          return;
        }
        setStreamStatus(reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

        const resp = await fetch(`/api/orchestration/runs/${runId}/stream`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          signal: abort.signal,
        });
        if (!resp.ok || !resp.body) {
          setStreamStatus('error');
          scheduleReconnect();
          return;
        }
        setStreamStatus('open');
        reconnectAttempt = 0;

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

            let eventType = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }

            if (dataLines.length > 0) {
              try {
                const data = JSON.parse(dataLines.join('\n'));
                useRunOverlayStore.getState().applyEvent(runId, { ...data, type: eventType });
              } catch (err) {
                logger.warn('useRunStream: malformed SSE frame', { err: String(err) });
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
        const latestState = useRunOverlayStore.getState();
        if (latestState.runId !== runId) return;
        if (isRunActive(latestState.runStatus)) {
          scheduleReconnect();
        } else {
          setStreamStatus('closed');
        }
      } catch (err) {
        if (cancelled || abort?.signal.aborted) return;
        logger.warn('useRunStream: stream failed', { err: String(err) });
        setStreamStatus('error');
        scheduleReconnect();
      }
    };

    const syncAndPump = async () => {
      try {
        await pump();
      } catch (err) {
        if (cancelled) return;
        logger.warn('useRunStream: reconnect loop failed', { err: String(err) });
        scheduleReconnect();
      }
    };

    void syncAndPump();

    return () => {
      cancelled = true;
      clearReconnect();
      abort?.abort();
      useRunOverlayStore.getState().clearRun(runId);
    };
  }, [runId]);
}
