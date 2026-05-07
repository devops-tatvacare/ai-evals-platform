import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  getConnection: vi.fn(),
}));

import { getConnection } from '@/services/api/orchestrationConnections';
import { WatiChannelPicker } from '@/features/orchestration/components/connections/WatiChannelPicker';

const mockedGet = getConnection as ReturnType<typeof vi.fn>;

function makeConnection(channelNumbers: string[]) {
  return {
    id: 'conn-1',
    tenantId: 't',
    appId: 'inside-sales',
    provider: 'wati',
    name: 'WATI prod',
    active: true,
    lastUsedAt: null,
    webhookUrl: null,
    configRedacted: { channel_numbers: channelNumbers },
    fields: [],
    createdBy: 'u',
    createdAt: '',
    updatedAt: '',
  };
}

function renderPicker(props: Partial<React.ComponentProps<typeof WatiChannelPicker>> = {}) {
  return render(
    <WatiChannelPicker
      connectionId="conn-1"
      value=""
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('WatiChannelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Radix Select calls scrollIntoView on its highlighted item; jsdom
    // doesn't implement it. Stub it so the dropdown can mount.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows the placeholder when no connection is selected', () => {
    renderPicker({ connectionId: undefined });
    expect(
      screen.getByText(/Pick a WATI connection/i),
    ).toBeInTheDocument();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('loads channel_numbers from the connection and selects one', async () => {
    mockedGet.mockResolvedValue(
      makeConnection(['+919999990000', '+919999990001']),
    );
    const onChange = vi.fn();
    renderPicker({ onChange });

    await waitFor(() =>
      expect(getConnection).toHaveBeenCalledWith('conn-1'),
    );

    fireEvent.click(await screen.findByRole('combobox', { name: /Select a channel number/i }));
    fireEvent.click(await screen.findByText('+919999990001'));
    expect(onChange).toHaveBeenCalledWith('+919999990001');
  });

  it('renders the empty-state hint when no channel_numbers configured', async () => {
    mockedGet.mockResolvedValue(makeConnection([]));
    renderPicker();
    expect(
      await screen.findByText(/Add channel numbers to this connection first/i),
    ).toBeInTheDocument();
  });
});
