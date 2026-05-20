import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMessagePart } from '@/features/sherlock/generated/sherlockContract';
import { handleFrame, type TurnTerminal } from '@/features/sherlock/sse';
import {
  selectSessionParts,
  useStreamStore,
} from '@/features/sherlock/streamStore';

function makeFrame(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}`;
}

function userPart(id: string): UserMessagePart {
  return {
    id,
    type: 'user_message',
    chat_session_id: 'sess-1',
    seq: 1,
    created_at: 0,
    text: 'hi',
  };
}

function args(
  frame: string,
  options: {
    sessionId?: string;
    invalidate?: () => void;
    onTerminal?: (t: TurnTerminal) => void;
    onSession?: (s: { sessionId: string; provider: string; model: string }) => void;
  } = {},
) {
  return {
    frame,
    sessionId: options.sessionId ?? 'sess-1',
    invalidateSnapshot: options.invalidate ?? (() => undefined),
    onTerminal: options.onTerminal ?? (() => undefined),
    onSession: options.onSession,
  };
}

describe('sherlock sse handleFrame', () => {
  beforeEach(() => {
    useStreamStore.setState({
      partsBySession: {},
      lastSeqBySession: {},
      hasGapBySession: {},
      status: 'idle',
    });
  });

  it('part_added applies to the store and does not invalidate', () => {
    const invalidate = vi.fn();
    handleFrame(args(makeFrame('part_added', { seq: 1, part: userPart('u1') }), { invalidate }));
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('malformed JSON triggers snapshot invalidation', () => {
    const invalidate = vi.fn();
    handleFrame(args('event: part_added\ndata: {bad', { invalidate }));
    expect(invalidate).toHaveBeenCalledOnce();
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(0);
  });

  it('part frame missing seq/part triggers snapshot invalidation', () => {
    const invalidate = vi.fn();
    handleFrame(args(makeFrame('part_added', { wrong: 'shape' }), { invalidate }));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('part failing ajv validation triggers snapshot invalidation', () => {
    const invalidate = vi.fn();
    handleFrame(
      args(makeFrame('part_added', { seq: 1, part: { type: 'user_message' /* missing required */ } }), {
        invalidate,
      }),
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('seq gap triggers snapshot invalidation', () => {
    useStreamStore.getState().seed('sess-1', [userPart('u0')], 1);
    const invalidate = vi.fn();
    handleFrame(args(makeFrame('part_added', { seq: 5, part: userPart('u1') }), { invalidate }));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('unknown event names are ignored without invalidation', () => {
    const invalidate = vi.fn();
    handleFrame(args(makeFrame('something_new', { seq: 1 }), { invalidate }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('session event fires onSession with parsed metadata', () => {
    const onSession = vi.fn();
    handleFrame(
      args(makeFrame('session', { sessionId: 'sess-99', provider: 'openai', model: 'gpt-5' }), {
        onSession,
      }),
    );
    expect(onSession).toHaveBeenCalledWith({
      sessionId: 'sess-99',
      provider: 'openai',
      model: 'gpt-5',
    });
  });

  it('turn_terminal reads backend snake_case last_error', () => {
    const onTerminal = vi.fn();
    handleFrame(
      args(makeFrame('turn_terminal', { status: 'error', last_error: 'boom' }), {
        onTerminal,
      }),
    );
    expect(onTerminal).toHaveBeenCalledWith({ status: 'error', lastError: 'boom' });
  });

  it('turn_terminal accepts degraded status as terminal', () => {
    const onTerminal = vi.fn();
    handleFrame(
      args(makeFrame('turn_terminal', { status: 'degraded', last_error: null }), {
        onTerminal,
      }),
    );
    expect(onTerminal).toHaveBeenCalledWith({ status: 'degraded', lastError: null });
  });

  it('turn_terminal maps legacy failed status to error', () => {
    const onTerminal = vi.fn();
    handleFrame(
      args(makeFrame('turn_terminal', { status: 'failed', last_error: 'x' }), {
        onTerminal,
      }),
    );
    expect(onTerminal).toHaveBeenCalledWith({ status: 'error', lastError: 'x' });
  });

  it('turn_terminal with unknown status does not fire onTerminal', () => {
    const onTerminal = vi.fn();
    handleFrame(args(makeFrame('turn_terminal', { status: 'weird' }), { onTerminal }));
    expect(onTerminal).not.toHaveBeenCalled();
  });
});
