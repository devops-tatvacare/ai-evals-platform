import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestration', () => ({
  listActionTemplates: vi.fn(),
}));

import { ActionTemplatePicker } from '@/features/orchestration/components/connections/ActionTemplatePicker';
import { listActionTemplates } from '@/services/api/orchestration';

const mockedList = listActionTemplates as ReturnType<typeof vi.fn>;

describe('ActionTemplatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads action templates and emits the slug when one is selected', async () => {
    mockedList.mockResolvedValue([
      {
        id: '1',
        channel: 'wati',
        slug: 'concierge_priority',
        name: 'Concierge — Priority Lane',
        payloadSchema: {},
        active: true,
      },
    ]);
    const onChange = vi.fn();

    render(
      <ActionTemplatePicker
        appId="inside-sales"
        channel="wati"
        value=""
        onChange={onChange}
      />,
    );

    await waitFor(() =>
      expect(listActionTemplates).toHaveBeenCalledWith({
        appId: 'inside-sales',
        channel: 'wati',
      }),
    );

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('concierge_priority'),
    );
  });

  it('renders available templates with human names rather than raw slug labels', async () => {
    mockedList.mockResolvedValue([
      {
        id: '1',
        channel: 'bolna',
        slug: 'concierge_confirmation',
        name: 'Concierge — Slot Confirmation',
        payloadSchema: {},
        active: true,
      },
      {
        id: '2',
        channel: 'bolna',
        slug: 'bolna_two_lead_test',
        name: 'Bolna — Two Lead Test',
        payloadSchema: {},
        active: true,
      },
    ]);

    render(
      <ActionTemplatePicker
        appId="inside-sales"
        channel="bolna"
        value=""
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Select an action template/i }));
    expect(await screen.findByText('Concierge — Slot Confirmation')).toBeInTheDocument();
    expect(await screen.findByText('Bolna — Two Lead Test')).toBeInTheDocument();
  });
});
