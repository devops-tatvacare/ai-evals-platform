import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  listConnectionAgents: vi.fn(),
}));

import { listConnectionAgents } from '@/services/api/orchestrationConnections';
import { BolnaAgentPicker } from '@/features/orchestration/components/connections/BolnaAgentPicker';

const mockedList = listConnectionAgents as ReturnType<typeof vi.fn>;

function renderPicker(props: Partial<React.ComponentProps<typeof BolnaAgentPicker>> = {}) {
  return render(
    <BolnaAgentPicker
      connectionId="conn-1"
      value=""
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('BolnaAgentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a placeholder when no connection is selected and skips fetching', () => {
    renderPicker({ connectionId: undefined });
    expect(
      screen.getByText(/Pick a Bolna connection/i),
    ).toBeInTheDocument();
    expect(listConnectionAgents).not.toHaveBeenCalled();
  });

  it('loads agents on mount and selects one through the combobox', async () => {
    mockedList.mockResolvedValue({
      provider: 'bolna',
      items: [
        { id: 'agent-a', name: 'Concierge', status: 'active', type: 'outbound' },
        { id: 'agent-b', name: 'Reminder', status: 'draft', type: 'outbound' },
      ],
      error: null,
    });
    const onChange = vi.fn();
    renderPicker({ onChange });

    await waitFor(() =>
      expect(listConnectionAgents).toHaveBeenCalledWith('conn-1', { refresh: false }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Select an agent/i }));
    fireEvent.click(await screen.findByText('Reminder'));
    expect(onChange).toHaveBeenCalledWith('agent-b');
  });

  it('renders the empty-state hint when no agents come back', async () => {
    mockedList.mockResolvedValue({ provider: 'bolna', items: [], error: null });
    renderPicker();
    expect(
      await screen.findByText(/No agents found\./i),
    ).toBeInTheDocument();
  });

  it('surfaces the soft error from the upstream call', async () => {
    mockedList.mockResolvedValue({
      provider: 'bolna',
      items: [],
      error: 'Bolna 401: unauthorized',
    });
    renderPicker();
    expect(
      await screen.findByText(/Bolna 401: unauthorized/i),
    ).toBeInTheDocument();
  });

  it('forwards refresh=true when the operator clicks Refresh', async () => {
    mockedList.mockResolvedValue({ provider: 'bolna', items: [], error: null });
    renderPicker();

    await waitFor(() =>
      expect(listConnectionAgents).toHaveBeenCalledWith('conn-1', { refresh: false }),
    );
    mockedList.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Refresh agents/i }));
    await waitFor(() =>
      expect(listConnectionAgents).toHaveBeenCalledWith('conn-1', { refresh: true }),
    );
  });
});
