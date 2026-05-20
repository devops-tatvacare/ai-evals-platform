import { describe, expect, it } from 'vitest';

import { groupPartsIntoTurns } from '@/features/sherlock/grouping';
import type {
  AssistantTextPart,
  ErrorPart,
  SherlockPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  ToolPart,
  UserMessagePart,
} from '@/features/sherlock/generated/sherlockContract';

const BASE = { chat_session_id: 'sess-1', created_at: 0 } as const;

function stepStart(seq: number, turnId: string): StepStartPart {
  return { ...BASE, id: `ss-${seq}`, seq, type: 'step_start', turn_id: turnId };
}
function userMsg(seq: number, text = 'hi'): UserMessagePart {
  return { ...BASE, id: `um-${seq}`, seq, type: 'user_message', text };
}
function subtask(seq: number, callId: string): SubtaskPart {
  return {
    ...BASE,
    id: `st-${seq}`,
    seq,
    type: 'subtask',
    specialist: 'data_specialist',
    call_id: callId,
    brief: {
      question: 'q',
      scope: { tenant_id: 't', app_id: 'a', user_id: 'u' },
      prior_attempts: [],
      retry_hint: null,
    },
  };
}
function tool(seq: number, callId: string, status: 'pending' | 'completed' = 'completed'): ToolPart {
  return {
    ...BASE,
    id: `tl-${seq}`,
    seq,
    type: 'tool',
    call_id: callId,
    tool: 'submit_sql',
    state:
      status === 'pending'
        ? { status: 'pending', input: {}, raw: '' }
        : { status: 'completed', input: {}, output: 'ok', title: 'submit_sql', metadata: {}, started_at: 0, ended_at: 100 },
  };
}
function assistantText(seq: number, text = 'answer', final = true): AssistantTextPart {
  return { ...BASE, id: `at-${seq}`, seq, type: 'assistant_text', text, final };
}
function errorPart(seq: number): ErrorPart {
  return { ...BASE, id: `er-${seq}`, seq, type: 'error', source: 'supervisor', message: 'boom', recoverable: true };
}
function stepFinish(seq: number, turnId: string, status = 'done'): StepFinishPart {
  return {
    ...BASE,
    id: `sf-${seq}`,
    seq,
    type: 'step_finish',
    turn_id: turnId,
    status,
    last_response_id: null,
    tokens_in: 10,
    tokens_out: 20,
  };
}

describe('groupPartsIntoTurns', () => {
  it('returns no turns for an empty stream', () => {
    expect(groupPartsIntoTurns([])).toEqual([]);
  });

  it('splits a single backend step into a user turn then an assistant turn', () => {
    // Backend emits step_start → user_message → assistant parts → step_finish.
    const parts: SherlockPart[] = [
      stepStart(0, 'turn-1'),
      userMsg(1, 'how many leads?'),
      subtask(2, 'call_1'),
      tool(3, 'call_1'),
      assistantText(4, '7,201 leads'),
      stepFinish(5, 'turn-1'),
    ];
    const turns = groupPartsIntoTurns(parts);
    expect(turns).toHaveLength(2);

    expect(turns[0].role).toBe('user');
    expect(turns[0].parts.map((p) => p.id)).toEqual(['um-1']);

    expect(turns[1].role).toBe('assistant');
    expect(turns[1].parts.map((p) => p.id)).toEqual(['st-2', 'tl-3', 'at-4']);
    expect(turns[1].stepFinish?.id).toBe('sf-5');
  });

  it('keeps two steps as four ordered turns', () => {
    const parts: SherlockPart[] = [
      stepStart(0, 'turn-1'),
      userMsg(1, 'first'),
      assistantText(2, 'a1'),
      stepFinish(3, 'turn-1'),
      stepStart(4, 'turn-2'),
      userMsg(5, 'second'),
      assistantText(6, 'a2'),
      stepFinish(7, 'turn-2'),
    ];
    const turns = groupPartsIntoTurns(parts);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(turns[3].stepFinish?.id).toBe('sf-7');
  });

  it('keeps an in-flight assistant turn (no step_finish yet)', () => {
    const parts: SherlockPart[] = [
      stepStart(0, 'turn-1'),
      userMsg(1),
      subtask(2, 'call_1'),
      tool(3, 'call_1', 'pending'),
    ];
    const turns = groupPartsIntoTurns(parts);
    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].stepFinish).toBeUndefined();
    expect(turns[1].parts.map((p) => p.id)).toEqual(['st-2', 'tl-3']);
  });

  it('attaches a terminal error part to the assistant turn it belongs to', () => {
    const parts: SherlockPart[] = [
      stepStart(0, 'turn-1'),
      userMsg(1),
      errorPart(2),
      stepFinish(3, 'turn-1', 'error'),
    ];
    const turns = groupPartsIntoTurns(parts);
    expect(turns).toHaveLength(2);
    expect(turns[1].role).toBe('assistant');
    expect(turns[1].parts.map((p) => p.type)).toEqual(['error']);
    expect(turns[1].stepFinish?.status).toBe('error');
  });

  it('sorts by seq before grouping (stream arrival order is not trusted)', () => {
    const parts: SherlockPart[] = [
      assistantText(4, 'answer'),
      stepStart(0, 'turn-1'),
      stepFinish(5, 'turn-1'),
      userMsg(1),
      tool(3, 'call_1'),
      subtask(2, 'call_1'),
    ];
    const turns = groupPartsIntoTurns(parts);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns[1].parts.map((p) => p.id)).toEqual(['st-2', 'tl-3', 'at-4']);
  });

  it('groups assistant parts even when step boundaries are absent (defensive)', () => {
    const parts: SherlockPart[] = [userMsg(0), assistantText(1, 'answer')];
    const turns = groupPartsIntoTurns(parts);
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(turns[1].parts.map((p) => p.id)).toEqual(['at-1']);
  });
});
