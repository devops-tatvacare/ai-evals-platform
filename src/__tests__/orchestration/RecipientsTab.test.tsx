import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestration', () => ({
  listRunRecipients: vi.fn(),
}));

import { listRunRecipients } from '@/services/api/orchestration';
import { RecipientsTab } from '@/features/orchestration/components/RecipientsTab';

const mockedListRunRecipients = listRunRecipients as ReturnType<typeof vi.fn>;

describe('RecipientsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockedListRunRecipients.mockResolvedValue([
      {
        recipientId: 'lead-1',
        currentNodeId: 'core.webhook_out',
        status: 'waiting',
        wakeupAt: null,
        payload: {
          last_outcome: 'wa_replied',
          last_event_at: '2026-05-04T12:00:00Z',
        },
        enrolledAt: '2026-05-04T10:00:00Z',
        completedAt: null,
        error: null,
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the last outcome and last event columns from recipient payload', async () => {
    render(<RecipientsTab runId="run-1" runStatus="completed" />);

    await waitFor(() =>
      expect(mockedListRunRecipients).toHaveBeenCalledWith('run-1', {
        limit: 50,
        offset: 0,
      }),
    );

    expect(await screen.findByText('wa_replied')).toBeInTheDocument();
    expect(
      screen.getByText(new Date('2026-05-04T12:00:00Z').toLocaleString()),
    ).toBeInTheDocument();
  });

  it('keeps polling completed runs while a recipient is still waiting on provider reconciliation', async () => {
    vi.useFakeTimers();
    mockedListRunRecipients
      .mockResolvedValueOnce([
        {
          recipientId: 'lead-1',
          currentNodeId: null,
          status: 'completed',
          wakeupAt: null,
          payload: {
            last_outcome: 'voice_queued',
            last_event_at: '2026-05-04T12:00:00Z',
          },
          enrolledAt: '2026-05-04T10:00:00Z',
          completedAt: '2026-05-04T10:01:00Z',
          error: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          recipientId: 'lead-1',
          currentNodeId: null,
          status: 'completed',
          wakeupAt: null,
          payload: {
            last_outcome: 'bolna_answered',
            last_event_at: '2026-05-04T12:05:00Z',
          },
          enrolledAt: '2026-05-04T10:00:00Z',
          completedAt: '2026-05-04T10:01:00Z',
          error: null,
        },
      ]);

    render(<RecipientsTab runId="run-1" runStatus="completed" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockedListRunRecipients).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockedListRunRecipients).toHaveBeenCalledTimes(2);
  });

  it('hides the wake-up column when no recipient is suspended', async () => {
    render(<RecipientsTab runId="run-1" runStatus="completed" />);

    await waitFor(() => expect(mockedListRunRecipients).toHaveBeenCalled());

    expect(screen.queryByText('Wake-up')).not.toBeInTheDocument();
  });

  it('shows the wake-up column when at least one recipient is waiting on a timer', async () => {
    mockedListRunRecipients.mockResolvedValueOnce([
      {
        recipientId: 'lead-2',
        currentNodeId: 'logic.wait',
        status: 'waiting',
        wakeupAt: '2026-05-04T13:00:00Z',
        payload: {},
        enrolledAt: '2026-05-04T10:00:00Z',
        completedAt: null,
        error: null,
      },
    ]);

    render(<RecipientsTab runId="run-1" runStatus="waiting" />);

    await waitFor(() => expect(mockedListRunRecipients).toHaveBeenCalled());

    expect(screen.getByText('Wake-up')).toBeInTheDocument();
    expect(
      screen.getByText(new Date('2026-05-04T13:00:00Z').toLocaleString()),
    ).toBeInTheDocument();
  });
});
