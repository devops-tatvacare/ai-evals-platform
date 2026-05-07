import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActionDetailPanel } from '@/features/orchestration/components/ActionDetailPanel';
import type { ActionRow } from '@/features/orchestration/types';

function bolnaAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a-1',
    recipientId: 'L-1',
    channel: 'bolna',
    actionType: 'bolna_queued',
    status: 'success',
    idempotencyKey: 'idem-1',
    payload: {},
    response: {
      execution_id: 'ex-1',
      provider_status: 'completed',
      provider_terminal: true,
      transcript: 'Hello, how are you?',
      recording_url: 'https://example.com/recording.mp3',
      total_cost: 0.0012,
      cost_breakdown: { llm: 0.0005, network: 0.0007, platform: 0.0 },
      telephony_provider: 'twilio',
      hangup_reason: 'caller_hangup',
      duration_sec: 75,
    },
    error: null,
    parentActionId: null,
    createdAt: '2026-05-04T10:00:00Z',
    completedAt: '2026-05-04T10:01:30Z',
    ...overrides,
  };
}

function watiAction(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: 'a-2',
    recipientId: 'L-2',
    channel: 'wati',
    actionType: 'wa_replied',
    status: 'success',
    idempotencyKey: 'idem-2',
    payload: {
      template_name: 'mql_followup',
      broadcast_name: 'mql_2026_05_04',
      channel_number: '+919999999999',
      template_payload: [{ name: 'first_name', value: 'Asha' }],
      localMessageId: 'lmid-abc-123',
    },
    response: { localMessageId: 'lmid-abc-123' },
    error: null,
    parentActionId: null,
    createdAt: '2026-05-04T11:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

describe('ActionDetailPanel', () => {
  it('renders nothing when closed', () => {
    render(<ActionDetailPanel action={null} open={false} onClose={vi.fn()} />);
    expect(screen.queryByText(/Recipient/)).toBeNull();
  });

  it('renders the Bolna variant with audio, transcript, costs, and telephony', () => {
    render(<ActionDetailPanel action={bolnaAction()} open onClose={vi.fn()} />);

    expect(screen.getByText('L-1')).toBeInTheDocument();
    // Status badge + timeline both render the terminal label.
    expect(screen.getAllByText('completed').length).toBeGreaterThanOrEqual(1);
    // Telephony + hangup reason rows.
    expect(screen.getByText('twilio')).toBeInTheDocument();
    expect(screen.getByText('caller_hangup')).toBeInTheDocument();
    // Cost breakdown line items rendered.
    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('$0.0012')).toBeInTheDocument();
    expect(screen.getByText('$0.0005')).toBeInTheDocument();
    // Recording link.
    expect(screen.getByText(/Open in new tab/)).toBeInTheDocument();
    // Execution id.
    expect(screen.getByText('ex-1')).toBeInTheDocument();
    expect(screen.getByText('Raw JSON')).toBeInTheDocument();
  });

  it('renders the WATI variant with template info, channel, and variables table', () => {
    render(<ActionDetailPanel action={watiAction()} open onClose={vi.fn()} />);

    expect(screen.getByText('L-2')).toBeInTheDocument();
    expect(screen.getByText('mql_followup')).toBeInTheDocument();
    expect(screen.getByText('mql_2026_05_04')).toBeInTheDocument();
    expect(screen.getByText('+919999999999')).toBeInTheDocument();
    expect(screen.getByText('lmid-abc-123')).toBeInTheDocument();
    // Variable rendered.
    expect(screen.getByText('first_name')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
  });

  it('falls back to a generic body for unknown channels', () => {
    const generic: ActionRow = {
      id: 'a-3',
      recipientId: 'L-3',
      channel: 'sms',
      actionType: 'sms_sent',
      status: 'failed',
      idempotencyKey: 'idem-3',
      payload: {},
      response: null,
      error: 'provider unreachable',
      parentActionId: null,
      createdAt: '2026-05-04T12:00:00Z',
      completedAt: null,
    };
    render(<ActionDetailPanel action={generic} open onClose={vi.fn()} />);

    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getAllByText('SMS Sent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('provider unreachable')).toBeInTheDocument();
  });

  it('handles a Bolna action without recording / transcript / cost gracefully', () => {
    const sparse = bolnaAction({
      response: {
        execution_id: 'ex-2',
        provider_status: 'no-answer',
        provider_terminal: true,
      },
    });
    render(<ActionDetailPanel action={sparse} open onClose={vi.fn()} />);

    expect(screen.getAllByText('no-answer').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Open in new tab/)).toBeNull();
    expect(screen.getByText(/No cost recorded/)).toBeInTheDocument();
  });

  it('renders nested Bolna cost breakdowns as structured sections instead of inline JSON blobs', () => {
    const detailed = bolnaAction({
      response: {
        execution_id: 'ex-9',
        provider_status: 'completed',
        provider_terminal: true,
        total_cost: 0.2704,
        cost_breakdown: {
          llm: 0.0391,
          network: 0.015,
          llm_breakdown: {
            conversation: 0.038,
            summary: 0.0007,
          },
          synthesizer_breakdown: {
            conversation: 0.1614,
          },
        },
      },
    });
    render(<ActionDetailPanel action={detailed} open onClose={vi.fn()} />);

    expect(screen.getByText('LLM Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Synthesizer Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('Conversation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$0.0380')).toBeInTheDocument();
  });
});
