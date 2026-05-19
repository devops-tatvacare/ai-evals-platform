import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { streamTurn } from '@/features/sherlock/sse';
import {
  selectSessionParts,
  useStreamStore,
} from '@/features/sherlock/streamStore';
import { useAuthStore } from '@/stores/authStore';

function frame(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function userPart(id: string, seq: number, sessionId: string) {
  return {
    id,
    type: 'user_message' as const,
    chat_session_id: sessionId,
    seq,
    created_at: 0,
    text: 'hi',
  };
}

function buildResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  useStreamStore.setState({
    partsBySession: {},
    lastSeqBySession: {},
    hasGapBySession: {},
    status: 'idle',
  });
  useAuthStore.setState({ accessToken: 'test-token' } as never, false);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('streamTurn', () => {
  it('mints a sessionId via session frame and applies follow-up parts under it', async () => {
    const queryClient = new QueryClient();
    const sessionFrame = frame('session', { sessionId: 'sess-new', provider: 'openai', model: 'gpt' });
    const partFrame = frame('part_added', { seq: 1, part: userPart('p1', 1, 'sess-new') });
    const terminalFrame = frame('turn_terminal', { status: 'done', last_error: null });
    globalThis.fetch = vi.fn().mockResolvedValue(buildResponse([sessionFrame + partFrame + terminalFrame]));
    const onSession = vi.fn();

    const ctrl = streamTurn({
      appId: 'inside-sales',
      sessionId: null,
      turnId: 'turn-1',
      message: 'hi',
      model: 'server-resolved',
      queryClient,
      onSession,
    });

    const term = await ctrl.done;
    expect(term).toEqual({ status: 'done', lastError: null });
    expect(onSession).toHaveBeenCalledWith({
      sessionId: 'sess-new',
      provider: 'openai',
      model: 'gpt',
    });
    expect(selectSessionParts('sess-new')(useStreamStore.getState())).toHaveLength(1);
  });

  it('buffers part frames that arrive before the session frame', async () => {
    const queryClient = new QueryClient();
    // Part arrives BEFORE session — exercise the pendingFrames queue.
    const partFrame = frame('part_added', { seq: 1, part: userPart('p1', 1, 'sess-late') });
    const sessionFrame = frame('session', {
      sessionId: 'sess-late',
      provider: 'openai',
      model: 'gpt',
    });
    const terminalFrame = frame('turn_terminal', { status: 'done', last_error: null });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(buildResponse([partFrame, sessionFrame, terminalFrame]));

    const ctrl = streamTurn({
      appId: 'inside-sales',
      sessionId: null,
      turnId: 'turn-2',
      message: 'hi',
      model: 'server-resolved',
      queryClient,
    });

    await ctrl.done;
    expect(selectSessionParts('sess-late')(useStreamStore.getState())).toHaveLength(1);
  });

  it('surfaces snake_case last_error on terminal frames', async () => {
    const queryClient = new QueryClient();
    const sessionFrame = frame('session', {
      sessionId: 'sess-err',
      provider: 'openai',
      model: 'gpt',
    });
    const terminalFrame = frame('turn_terminal', { status: 'error', last_error: 'kaboom' });
    globalThis.fetch = vi.fn().mockResolvedValue(buildResponse([sessionFrame + terminalFrame]));

    const ctrl = streamTurn({
      appId: 'inside-sales',
      sessionId: null,
      turnId: 'turn-3',
      message: 'hi',
      model: 'server-resolved',
      queryClient,
    });

    const term = await ctrl.done;
    expect(term).toEqual({ status: 'error', lastError: 'kaboom' });
  });

  it('abort() finalizes interrupted without firing additional part frames', async () => {
    const queryClient = new QueryClient();
    // Long-running stream: open a stream that never closes; we abort it mid-flight.
    let resolveBody: () => void = () => {};
    const bodyPromise = new Promise<void>((r) => {
      resolveBody = r;
    });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(frame('session', { sessionId: 'sess-abort', provider: 'openai', model: 'gpt' })),
        );
        await bodyPromise;
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const onTerminal = vi.fn();
    const ctrl = streamTurn({
      appId: 'inside-sales',
      sessionId: null,
      turnId: 'turn-4',
      message: 'hi',
      model: 'server-resolved',
      queryClient,
      onTerminal,
    });

    // Give the reader loop one tick to pull the session frame.
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    const term = await ctrl.done;
    expect(term).toEqual({ status: 'interrupted', lastError: null });
    expect(onTerminal).toHaveBeenCalledWith({ status: 'interrupted', lastError: null });
    resolveBody();
  });

  it('finalizes error when fetch rejects', async () => {
    const queryClient = new QueryClient();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const ctrl = streamTurn({
      appId: 'inside-sales',
      sessionId: null,
      turnId: 'turn-5',
      message: 'hi',
      model: 'server-resolved',
      queryClient,
    });

    const term = await ctrl.done;
    expect(term.status).toBe('error');
    expect(term.lastError).toBe('Network error while streaming the turn.');
  });
});
