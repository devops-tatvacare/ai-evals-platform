import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PartList } from '@/features/sherlock/PartList';
import type {
  AssistantTextPart,
  ChartPart,
  CompactionPart,
  ErrorPart,
  EvidencePart,
  ReasoningPart,
  RetryPart,
  StepFinishPart,
  StepStartPart,
  SherlockPart,
  SubtaskPart,
  ToolPart,
  UserMessagePart,
} from '@/features/sherlock/generated/sherlockContract';

const PART_BASE = { chat_session_id: 'sess-1', seq: 0, created_at: 0 } as const;

const FIXTURES = {
  user_message: { ...PART_BASE, id: 'p-um', type: 'user_message', text: 'hi' } as UserMessagePart,
  subtask: {
    ...PART_BASE,
    id: 'p-st',
    type: 'subtask',
    specialist: 'data_specialist',
    call_id: 'call_1',
    brief: {
      question: 'q',
      scope: { tenant_id: 't', app_id: 'a', user_id: 'u' },
      prior_attempts: [],
      retry_hint: null,
    },
  } as SubtaskPart,
  tool: {
    ...PART_BASE,
    id: 'p-tool',
    type: 'tool',
    call_id: 'call_1',
    tool: 'submit_sql',
    state: { status: 'pending', input: {}, raw: '' },
  } as ToolPart,
  retry: {
    ...PART_BASE,
    id: 'p-retry',
    type: 'retry',
    specialist: 'data_specialist',
    attempt_number: 2,
    failed_attempt: {
      sql: '',
      verdict: {
        status: 'invalid',
        diagnostic: {
          rule_id: 'ARG',
          rule_number: 0,
          rule_name: 'Submit arguments',
          message: 'bad',
        },
      },
      status: 'execution_error',
      row_count: null,
      error_message: 'boom',
    },
  } as RetryPart,
  assistant_text: {
    ...PART_BASE,
    id: 'p-at',
    type: 'assistant_text',
    text: 'hello',
    final: true,
  } as AssistantTextPart,
  reasoning: {
    ...PART_BASE,
    id: 'p-r',
    type: 'reasoning',
    text: 'thinking',
    final: false,
  } as ReasoningPart,
  chart: {
    ...PART_BASE,
    id: 'p-c',
    type: 'chart',
    artifact: { kind: 'empty', payload: {} },
  } as ChartPart,
  evidence: { ...PART_BASE, id: 'p-e', type: 'evidence', refs: [] } as EvidencePart,
  error: {
    ...PART_BASE,
    id: 'p-err',
    type: 'error',
    source: 'supervisor',
    message: 'oops',
    recoverable: true,
  } as ErrorPart,
  compaction: {
    ...PART_BASE,
    id: 'p-comp',
    type: 'compaction',
    summary: '',
    tokens_before: 1234,
  } as CompactionPart,
  step_start: {
    ...PART_BASE,
    id: 'p-ss',
    type: 'step_start',
    turn_id: 'turn-1',
  } as StepStartPart,
  step_finish: {
    ...PART_BASE,
    id: 'p-sf',
    type: 'step_finish',
    turn_id: 'turn-1',
    status: 'done',
    last_response_id: null,
    tokens_in: null,
    tokens_out: null,
  } as StepFinishPart,
} satisfies Record<string, SherlockPart>;

describe('PartList', () => {
  it('renders every SherlockPart arm without crashing', () => {
    const parts = Object.values(FIXTURES);
    const { container } = render(<PartList parts={parts} showStepMarkers />);
    for (const part of parts) {
      const node = container.querySelector(`[data-part-id="${part.id}"]`);
      expect(node, `arm ${part.type} did not render`).not.toBeNull();
    }
  });

  it('hides step_start / step_finish by default', () => {
    const parts: SherlockPart[] = [FIXTURES.step_start, FIXTURES.step_finish];
    const { container } = render(<PartList parts={parts} />);
    expect(container.querySelector('[data-part-type="step_start"]')).toBeNull();
    expect(container.querySelector('[data-part-type="step_finish"]')).toBeNull();
  });
});
