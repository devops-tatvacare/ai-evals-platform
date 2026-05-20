import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestration', () => ({
  listRunActions: vi.fn(),
}));

vi.mock('@/features/orchestration/components/ActionDetailPanel', () => ({
  ActionDetailPanel: ({
    action,
    open,
  }: {
    action: { id: string } | null;
    open: boolean;
  }) => (open && action ? <div data-testid="action-detail">{action.id}</div> : null),
}));

import { listRunActions } from '@/services/api/orchestration';
import { ActionLogTab } from '@/features/orchestration/components/ActionLogTab';

const mockedListRunActions = listRunActions as ReturnType<typeof vi.fn>;

describe('ActionLogTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockedListRunActions.mockResolvedValue([
      {
        id: 'action-1',
        recipientId: 'lead-1',
        channel: 'voice',
        actionType: 'voice_queued',
        status: 'success',
        idempotencyKey: 'idem-1',
        payload: {},
        providerStatus: 'completed',
        providerTerminal: true,
        response: {
          provider_status: 'completed',
          provider_terminal: true,
          hangup_reason: 'caller_hangup',
        },
        error: null,
        parentActionId: null,
        createdAt: '2026-05-04T10:00:00Z',
        completedAt: '2026-05-04T10:01:00Z',
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the detail chip and opens the detail panel on row click', async () => {
    render(<ActionLogTab runId="run-1" runStatus="completed" />);

    await waitFor(() =>
      expect(mockedListRunActions).toHaveBeenCalledWith('run-1', { limit: 100 }),
    );

    expect(await screen.findByText('completed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('lead-1'));
    expect(screen.getByTestId('action-detail')).toHaveTextContent('action-1');
  });

  it('keeps polling completed runs while provider reconciliation is still pending', async () => {
    vi.useFakeTimers();
    mockedListRunActions
      .mockResolvedValueOnce([
        {
          id: 'action-1',
          recipientId: 'lead-1',
          channel: 'voice',
          actionType: 'voice_queued',
          status: 'success',
          idempotencyKey: 'idem-1',
          payload: {},
          providerStatus: 'queued',
          providerTerminal: false,
          response: {
            provider_status: 'queued',
            provider_terminal: false,
          },
          error: null,
          parentActionId: null,
          createdAt: '2026-05-04T10:00:00Z',
          completedAt: '2026-05-04T10:01:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'action-1',
          recipientId: 'lead-1',
          channel: 'voice',
          actionType: 'voice_queued',
          status: 'success',
          idempotencyKey: 'idem-1',
          payload: {},
          providerStatus: 'completed',
          providerTerminal: true,
          response: {
            provider_status: 'completed',
            provider_terminal: true,
          },
          error: null,
          parentActionId: null,
          createdAt: '2026-05-04T10:00:00Z',
          completedAt: '2026-05-04T10:01:00Z',
        },
      ]);

    render(<ActionLogTab runId="run-1" runStatus="completed" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockedListRunActions).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockedListRunActions).toHaveBeenCalledTimes(2);
  });
});
