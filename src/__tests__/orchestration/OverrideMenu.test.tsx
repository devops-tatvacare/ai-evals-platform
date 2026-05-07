import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { OverrideMenu } from '@/features/orchestration/components/OverrideMenu';

vi.mock('@/services/api/orchestration', () => ({
  applyOverride: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/notifications/notificationService', () => ({
  notificationService: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { applyOverride } from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications/notificationService';

describe('OverrideMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens menu and applies pause action', async () => {
    const onApplied = vi.fn();
    render(<OverrideMenu runId="run-1" recipientId="rec-1" onApplied={onApplied} />);

    fireEvent.click(screen.getByLabelText('Override actions'));
    fireEvent.click(screen.getByText('Pause'));

    await waitFor(() => expect(applyOverride).toHaveBeenCalled());
    expect(applyOverride).toHaveBeenCalledWith(
      'run-1',
      'rec-1',
      { action: 'pause', reason: 'manual pause' },
    );
    expect(notificationService.success).toHaveBeenCalled();
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows error notification when API rejects', async () => {
    (applyOverride as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const onApplied = vi.fn();
    render(<OverrideMenu runId="run-1" recipientId="rec-1" onApplied={onApplied} />);

    fireEvent.click(screen.getByLabelText('Override actions'));
    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => expect(notificationService.error).toHaveBeenCalledWith('boom'));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('exposes all four actions: Pause, Resume, Remove from Run, Mark Complete', () => {
    render(<OverrideMenu runId="run-1" recipientId="rec-1" onApplied={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Override actions'));
    expect(screen.getByText('Pause')).toBeInTheDocument();
    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.getByText('Remove from Run')).toBeInTheDocument();
    expect(screen.getByText('Mark Complete')).toBeInTheDocument();
  });
});
