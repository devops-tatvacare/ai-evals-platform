import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/orchestrationConnections', () => ({
  listConnectionTemplates: vi.fn(),
}));

import { listConnectionTemplates } from '@/services/api/orchestrationConnections';
import { WatiTemplatePicker } from '@/features/orchestration/components/connections/WatiTemplatePicker';

const mockedList = listConnectionTemplates as ReturnType<typeof vi.fn>;

function renderPicker(props: Partial<React.ComponentProps<typeof WatiTemplatePicker>> = {}) {
  return render(
    <WatiTemplatePicker
      connectionId="conn-1"
      value=""
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('WatiTemplatePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the placeholder + skips fetching when no connection is selected', () => {
    renderPicker({ connectionId: undefined });
    expect(
      screen.getByText(/Pick a WATI connection/i),
    ).toBeInTheDocument();
    expect(listConnectionTemplates).not.toHaveBeenCalled();
  });

  it('loads templates and selects one through the combobox', async () => {
    mockedList.mockResolvedValue({
      provider: 'wati',
      items: [
        { name: 'concierge_qualify_v1', language: 'en', status: 'APPROVED', parameters: ['1'] },
        { name: 'concierge_priority_v1', language: 'en', status: 'APPROVED', parameters: ['1', '2'] },
      ],
      error: null,
    });
    const onChange = vi.fn();
    renderPicker({ onChange });

    await waitFor(() =>
      expect(listConnectionTemplates).toHaveBeenCalledWith('conn-1'),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Select a template/i }));
    fireEvent.click(await screen.findByText('concierge_priority_v1'));
    expect(onChange).toHaveBeenCalledWith('concierge_priority_v1');
  });

  it('renders the empty-state hint when no templates come back', async () => {
    mockedList.mockResolvedValue({ provider: 'wati', items: [], error: null });
    renderPicker();
    expect(
      await screen.findByText(/No templates found/i),
    ).toBeInTheDocument();
  });

  it('surfaces the soft error from the upstream call', async () => {
    mockedList.mockResolvedValue({
      provider: 'wati',
      items: [],
      error: 'WATI 401: unauthorized',
    });
    renderPicker();
    expect(
      await screen.findByText(/WATI 401: unauthorized/i),
    ).toBeInTheDocument();
  });

  it('forwards refresh=true when the operator clicks Refresh', async () => {
    mockedList.mockResolvedValue({ provider: 'wati', items: [], error: null });
    renderPicker();

    // Phase 14 — TanStack Query schedules the post-fetch state flush via its
    // own queue, so the Refresh button stays disabled until isFetching
    // settles to false. Wait for the button to become enabled (the empty-
    // state hint appearing is a proxy for "initial fetch complete").
    const refreshBtn = await screen.findByRole('button', {
      name: /Refresh templates/i,
    });
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());
    mockedList.mockClear();
    fireEvent.click(refreshBtn);
    await waitFor(() =>
      expect(listConnectionTemplates).toHaveBeenCalledWith('conn-1', { refresh: true }),
    );
  });

  it('surfaces refresh failures through query error state', async () => {
    mockedList
      .mockResolvedValueOnce({
        provider: 'wati',
        items: [{ name: 'seed', language: 'en', status: 'APPROVED', parameters: [] }],
        error: null,
      })
      .mockRejectedValueOnce(new Error('Refresh failed'));
    renderPicker();

    const refreshBtn = await screen.findByRole('button', {
      name: /Refresh templates/i,
    });
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());
    fireEvent.click(refreshBtn);

    expect(await screen.findByText(/Refresh failed/i)).toBeInTheDocument();
  });

  it('keeps the combobox row shrink-safe when a long template is selected', async () => {
    mockedList.mockResolvedValue({
      provider: 'wati',
      items: [
        { name: 'document_approved_latest', language: 'en', status: 'APPROVED', parameters: ['name'] },
      ],
      error: null,
    });
    renderPicker({ value: 'document_approved_latest' });

    const trigger = await screen.findByRole('button', { name: /document_approved_latest/i });
    expect(trigger.parentElement?.parentElement).toHaveClass('min-w-0', 'flex-1');
    expect(screen.getByRole('button', { name: /Refresh templates/i })).toHaveClass('shrink-0', 'whitespace-nowrap');
  });

  it('fires onTemplateLoaded with the matching template when value is set', async () => {
    mockedList.mockResolvedValue({
      provider: 'wati',
      items: [
        { name: 'concierge_qualify_v1', language: 'en', status: 'APPROVED', parameters: ['first_name'] },
      ],
      error: null,
    });
    const onTemplateLoaded = vi.fn();
    renderPicker({ value: 'concierge_qualify_v1', onTemplateLoaded });

    await waitFor(() => {
      expect(onTemplateLoaded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'concierge_qualify_v1',
          parameters: ['first_name'],
        }),
      );
    });
  });
});
