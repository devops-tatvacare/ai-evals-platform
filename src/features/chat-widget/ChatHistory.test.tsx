import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

const selectSession = vi.fn();
const clearActiveSession = vi.fn();
const listPage = vi.fn();
const searchHits = vi.fn();
const deleteSession = vi.fn();

vi.mock('@/stores', () => ({
  useAppStore: (sel: (s: { currentApp: string }) => unknown) => sel({ currentApp: 'kaira-bot' }),
}));

vi.mock('./useChatWidget', () => ({
  useChatWidgetStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ sessionId: null, selectSession, clearActiveSession }),
}));

vi.mock('@/services/api/chatApi', () => ({
  CHAT_SESSION_SOURCE: { sherlock: 'sherlock' },
  chatSessionsRepository: {
    listPage: (...args: unknown[]) => listPage(...args),
    searchHits: (...args: unknown[]) => searchHits(...args),
    delete: (...args: unknown[]) => deleteSession(...args),
  },
}));

import { ChatHistory } from './ChatHistory';

function renderHistory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatHistory />
    </QueryClientProvider>,
  );
}

const SESSION = {
  id: 'sess-1',
  appId: 'kaira-bot',
  tenantId: 't',
  userId: 'u',
  title: 'Conversations by intent',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  listPage.mockResolvedValue([SESSION]);
  searchHits.mockResolvedValue([]);
  deleteSession.mockResolvedValue(undefined);
});

describe('ChatHistory', () => {
  it('fires the delete request when the trash button is clicked (regression: nested button swallowed it)', async () => {
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText('Conversations by intent');

    await user.click(screen.getByRole('button', { name: /delete conversation/i }));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('kaira-bot', 'sess-1'));
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('selects the session when the browse row body is clicked', async () => {
    const user = userEvent.setup();
    renderHistory();
    await user.click(await screen.findByText('Conversations by intent'));
    expect(selectSession).toHaveBeenCalledWith('kaira-bot', 'sess-1');
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('switches to the search-hits endpoint and renders snippet hits with the term bolded', async () => {
    searchHits.mockResolvedValue([
      {
        sessionId: 'sess-9',
        title: "India's Fuel Price Stability",
        snippet: '…the cost for Indian Oil Marketing Compa…',
        matchedIn: 'message',
        updatedAt: new Date(),
      },
    ]);
    const user = userEvent.setup();
    renderHistory();
    await screen.findByText('Conversations by intent');

    await user.type(screen.getByPlaceholderText(/search conversations/i), 'india');

    await waitFor(() =>
      expect(searchHits).toHaveBeenCalledWith(
        'kaira-bot',
        expect.objectContaining({ q: 'india', limit: 20, offset: 0 }),
      ),
    );
    // The matched term is wrapped in <strong> (in title and/or snippet).
    const bolded = await screen.findAllByText('India', { selector: 'strong' });
    expect(bolded.length).toBeGreaterThan(0);
  });

  it('opens the session when a search hit is clicked', async () => {
    // Title has no match term so it renders as one text node we can click.
    searchHits.mockResolvedValue([
      { sessionId: 'sess-9', title: 'Fuel discussion', snippet: 'about India here', matchedIn: 'message', updatedAt: new Date() },
    ]);
    const user = userEvent.setup();
    renderHistory();
    await user.type(screen.getByPlaceholderText(/search conversations/i), 'india');
    const row = await screen.findByText('Fuel discussion');
    await user.click(row);
    expect(selectSession).toHaveBeenCalledWith('kaira-bot', 'sess-9');
  });
});
