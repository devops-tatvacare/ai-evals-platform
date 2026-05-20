import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TurnList } from '@/features/sherlock/TurnList';
import type {
  AssistantTextPart,
  ChartPart,
  SherlockPart,
  StepFinishPart,
  StepStartPart,
  SubtaskPart,
  SubtaskResult,
  UserMessagePart,
} from '@/features/sherlock/generated/sherlockContract';

const BASE = { chat_session_id: 'sess-1', created_at: 0 } as const;

const stepStart: StepStartPart = { ...BASE, id: 'ss', seq: 0, type: 'step_start', turn_id: 'turn-1' };
const userMsg: UserMessagePart = { ...BASE, id: 'um', seq: 1, type: 'user_message', text: 'how many leads?' };

function dataSubtask(seq: number, id: string, state: SubtaskPart['state']): SubtaskPart {
  return {
    ...BASE,
    id,
    seq,
    type: 'subtask',
    specialist: 'data_specialist',
    call_id: `call_${id}`,
    brief: { question: 'count leads', scope: { tenant_id: 't', app_id: 'a', user_id: 'u' }, prior_attempts: [], retry_hint: null },
    state,
  };
}
function completed(result: SubtaskResult): SubtaskPart['state'] {
  return { status: 'completed', started_at: 0, ended_at: 200, result };
}

const answer: AssistantTextPart = { ...BASE, id: 'at', seq: 4, type: 'assistant_text', text: '7,201 leads', final: true };
const chart: ChartPart = {
  ...BASE,
  id: 'ch',
  seq: 5,
  type: 'chart',
  artifact: {
    kind: 'kpi',
    payload: { kind: 'kpi', kpi: { label: 'Leads', value: 7201, format: 'integer' }, title: 'Leads', source_question: '', sql_query: '' },
  },
};
const stepFinish: StepFinishPart = {
  ...BASE,
  id: 'sf',
  seq: 6,
  type: 'step_finish',
  turn_id: 'turn-1',
  status: 'done',
  last_response_id: null,
  tokens_in: 1,
  tokens_out: 1,
};

describe('TurnList', () => {
  const settledParts: SherlockPart[] = [
    stepStart,
    userMsg,
    dataSubtask(2, 'st-data', completed({ status: 'ok', summary: 'Counted leads', sql: 'select count(*)', row_count: 1 })),
    chart,
    answer,
    stepFinish,
  ];

  it('renders the user question and the assistant answer', () => {
    render(<TurnList parts={settledParts} appId="inside-sales" sessionId={null} streaming={false} onRetry={() => {}} />);
    expect(screen.getByText('how many leads?')).toBeTruthy();
    expect(screen.getByText('7,201 leads')).toBeTruthy();
  });

  it('renders specialist runs as a collapsed summary that resolves (no perpetual spinner)', () => {
    const { container } = render(
      <TurnList parts={settledParts} appId="inside-sales" sessionId={null} streaming={false} onRetry={() => {}} />,
    );
    expect(container.querySelector('[data-part-type="specialist-group"]')).not.toBeNull();
    expect(screen.getByText(/Consulted the data specialist/i)).toBeTruthy();
    expect(screen.queryByText(/Consulting/i)).toBeNull();
  });

  it('routes a KPI artifact into a prominent number card', () => {
    render(<TurnList parts={settledParts} appId="inside-sales" sessionId={null} streaming={false} onRetry={() => {}} />);
    expect(screen.getByText('7,201')).toBeTruthy();
  });

  it('shows the thinking shimmer while an assistant turn is still streaming, with the group expanded', () => {
    const inflight: SherlockPart[] = [
      stepStart,
      userMsg,
      dataSubtask(2, 'st-data', { status: 'running', started_at: 0 }),
    ];
    const { container } = render(
      <TurnList parts={inflight} appId="inside-sales" sessionId={null} streaming onRetry={() => {}} />,
    );
    expect(container.querySelector('[data-testid="sherlock-thinking"]')).not.toBeNull();
    // group is expanded and the row reads "consulting…", honestly from state.
    expect(screen.getByText(/consulting…/i)).toBeTruthy();
  });

  it('resolves every specialist from its own state — no perpetual spinner on a settled turn', () => {
    // query_synthesis emits no tool; its subtask still carries a completed state.
    const qs: SubtaskPart = {
      ...BASE,
      id: 'st-qs',
      seq: 2,
      type: 'subtask',
      specialist: 'query_synthesis_specialist',
      call_id: 'call_qs',
      brief: { question: 'shape the query', scope: { tenant_id: 't', app_id: 'a', user_id: 'u' }, prior_attempts: [], retry_hint: null },
      state: completed({ status: 'ok', summary: '' }),
    };
    const settled: SherlockPart[] = [
      stepStart,
      userMsg,
      qs,
      dataSubtask(3, 'st-data', completed({ status: 'ok', summary: 'ok', sql: 'select 1', row_count: 13 })),
      answer,
      stepFinish,
    ];
    render(<TurnList parts={settled} appId="inside-sales" sessionId={null} streaming={false} onRetry={() => {}} />);
    expect(screen.queryByText(/Consulting/i)).toBeNull();
    expect(screen.getByText(/Consulted 2 specialists/i)).toBeTruthy();
  });
});
