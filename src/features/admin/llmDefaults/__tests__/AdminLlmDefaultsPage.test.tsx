import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AdminLlmDefaultsPage } from '../AdminLlmDefaultsPage';

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { permissions: [] } }),
}));

vi.mock('@/services/api/llmCredentialsQueries', () => ({
  useAllTenantCredentials: () => ({
    credentials: [
      { id: 'c1', provider: 'openai', name: 'default', isEnabled: true },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/services/api/llmCallSiteDefaultsQueries', () => ({
  useCallSiteRegistry: () => ({
    data: [
      {
        id: 'chat_text',
        requiredCapabilities: ['text_input', 'text_output'],
        optionalCapabilities: [],
        description: 'Plain text chat.',
        reference: 'Batch, adversarial, and custom evaluation runner replies.',
      },
    ],
    isLoading: false,
  }),
  useTenantCallSiteDefaults: () => ({ data: [] }),
  usePlatformCallSiteDefaults: () => ({ data: [] }),
  useUpsertTenantDefault: () => ({ mutateAsync: vi.fn() }),
  useDeleteTenantDefault: () => ({ mutateAsync: vi.fn() }),
  useUpsertPlatformDefault: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../useDirtyDefaults', () => ({
  useDirtyDefaults: () => ({
    getPick: () => null,
    setPick: vi.fn(),
    isDirty: () => false,
    getError: () => null,
    dirtyCount: 0,
    commitAll: vi.fn(),
  }),
}));

vi.mock('@/components/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/components/ui');
  return { ...actual, LlmModelSelect: () => <div data-testid="picker" /> };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminLlmDefaultsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminLlmDefaultsPage references', () => {
  it('renders the call-site reference line', () => {
    renderPage();
    expect(
      screen.getByText(
        'Batch, adversarial, and custom evaluation runner replies.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the selected section reference', () => {
    renderPage();
    expect(screen.getByText('Evaluation runner chat replies.')).toBeInTheDocument();
  });
});
