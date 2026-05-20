import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AssistantTextPart,
  UserMessagePart,
} from '@/features/sherlock/generated/sherlockContract';
import {
  selectSessionHasGap,
  selectSessionLastSeq,
  selectSessionParts,
  useStreamStore,
} from '@/features/sherlock/streamStore';

function user(id: string, text = 'hi'): UserMessagePart {
  return {
    id,
    type: 'user_message',
    chat_session_id: 'sess-1',
    seq: 0,
    created_at: 0,
    text,
  };
}

function assistant(id: string, text: string, final = false): AssistantTextPart {
  return {
    id,
    type: 'assistant_text',
    chat_session_id: 'sess-1',
    seq: 0,
    created_at: 0,
    text,
    final,
  };
}

describe('streamStore', () => {
  beforeEach(() => {
    useStreamStore.setState({
      partsBySession: {},
      lastSeqBySession: {},
      hasGapBySession: {},
      status: 'idle',
    });
  });

  it('seed installs parts + lastSeq + clears gap flag', () => {
    useStreamStore.getState().seed('sess-1', [user('u1')], 5);
    const state = useStreamStore.getState();
    expect(selectSessionParts('sess-1')(state)).toHaveLength(1);
    expect(selectSessionLastSeq('sess-1')(state)).toBe(5);
    expect(selectSessionHasGap('sess-1')(state)).toBe(false);
  });

  it('applyEvent part_added is idempotent on duplicate id', () => {
    const part = user('u1');
    useStreamStore.getState().seed('sess-1', [], 0);
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_added', seq: 1, part });
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_added', seq: 1, part });
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(1);
  });

  it('part_updated replaces by id, never duplicates', () => {
    const draft = assistant('a1', 'hel', false);
    const finalPart = assistant('a1', 'hello', true);
    useStreamStore.getState().seed('sess-1', [], 0);
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_added', seq: 1, part: draft });
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_updated', seq: 2, part: finalPart });
    const parts = selectSessionParts('sess-1')(useStreamStore.getState());
    expect(parts).toHaveLength(1);
    expect((parts[0] as AssistantTextPart).text).toBe('hello');
    expect((parts[0] as AssistantTextPart).final).toBe(true);
  });

  it('seq gap flips hasGap flag without losing the current event', () => {
    useStreamStore.getState().seed('sess-1', [user('u1')], 1);
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_added', seq: 5, part: user('u2') });
    const state = useStreamStore.getState();
    expect(selectSessionHasGap('sess-1')(state)).toBe(true);
    expect(selectSessionParts('sess-1')(state)).toHaveLength(2);
    expect(selectSessionLastSeq('sess-1')(state)).toBe(5);
  });

  it('seed after a gap clears the gap flag', () => {
    useStreamStore.getState().seed('sess-1', [user('u1')], 1);
    useStreamStore.getState().applyEvent('sess-1', { kind: 'part_added', seq: 5, part: user('u2') });
    expect(selectSessionHasGap('sess-1')(useStreamStore.getState())).toBe(true);
    useStreamStore.getState().seed('sess-1', [user('u1'), user('u2')], 5);
    expect(selectSessionHasGap('sess-1')(useStreamStore.getState())).toBe(false);
  });

  it('reset removes only the target session', () => {
    useStreamStore.getState().seed('sess-1', [user('u1')], 1);
    useStreamStore.getState().seed('sess-2', [user('u2')], 2);
    useStreamStore.getState().reset('sess-1');
    const state = useStreamStore.getState();
    expect(selectSessionParts('sess-1')(state)).toHaveLength(0);
    expect(selectSessionParts('sess-2')(state)).toHaveLength(1);
  });

  it('late part_updated for an unseen id is accepted (snapshot will reconcile)', () => {
    useStreamStore.getState().seed('sess-1', [], 0);
    useStreamStore.getState().applyEvent('sess-1', {
      kind: 'part_updated',
      seq: 1,
      part: assistant('a1', 'late', true),
    });
    expect(selectSessionParts('sess-1')(useStreamStore.getState())).toHaveLength(1);
  });
});
