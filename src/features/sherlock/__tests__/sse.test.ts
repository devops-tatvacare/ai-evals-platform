import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMessagePart } from '@/features/sherlock/generated/sherlockContract';
import { handleFrame } from '@/features/sherlock/sse';
import {
  selectSessionParts,
  useStreamStore,
} from '@/features/sherlock/streamStore';

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`;
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

describe('sherlock sse handleFrame', () => {
  beforeEach(() => {
    useStreamStore.setState({
      partsBySession: {},
      lastSeqBySession: {},
      hasGapBySession: {},
      status: 'idle',
    });
  });

  it('parses {kind, seq, part} and applies to the store', () => {
    const invalidate = vi.fn();
    handleFrame(
      'sess-1',
      frame({ kind: 'part_added', seq: 1, part: userPart('u1') }),
      invalidate,
    );
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('invalidates snapshot on malformed JSON', () => {
    const invalidate = vi.fn();
    handleFrame('sess-1', 'data: {bad', invalidate);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(0);
  });

  it('invalidates snapshot when envelope shape is wrong', () => {
    const invalidate = vi.fn();
    handleFrame('sess-1', frame({ wrong: 'shape' }), invalidate);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('invalidates snapshot when part fails ajv validation', () => {
    const invalidate = vi.fn();
    handleFrame(
      'sess-1',
      frame({ kind: 'part_added', seq: 1, part: { type: 'user_message' /* missing required */ } }),
      invalidate,
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('invalidates snapshot when a seq gap is detected', () => {
    useStreamStore.getState().seed('sess-1', [userPart('u0')], 1);
    const invalidate = vi.fn();
    handleFrame(
      'sess-1',
      frame({ kind: 'part_added', seq: 5, part: userPart('u1') }),
      invalidate,
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('ignores frames with no data: lines', () => {
    const invalidate = vi.fn();
    handleFrame('sess-1', 'event: keepalive', invalidate);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
