/**
 * Hook test for the legacy provider-summary list hook.
 *
 * Per-credential CRUD hooks live in `llmCredentialsQueries.ts` and are
 * covered separately. This file only exercises `useProviderConfigs` — the
 * GET still consumed by 8 pages for `credentialsOk` gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

vi.mock('@/services/api/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/services/api/client';
import {
  AI_SETTINGS_QUERY_KEY,
  useProviderConfigs,
} from './aiSettingsQueries';

const mockedApiRequest = apiRequest as unknown as ReturnType<typeof vi.fn>;

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

const PROVIDER_FIXTURE = {
  provider: 'openai',
  isEnabled: true,
  hasApiKey: true,
  apiKeyPreview: 'sk-p••••XYZ1',
  baseUrl: null,
  extraConfig: {},
  curatedModels: ['gpt-5.4'],
  validationStatus: 'ok',
  lastValidatedAt: null,
};

beforeEach(() => {
  mockedApiRequest.mockReset();
});

describe('useProviderConfigs', () => {
  it('GETs /api/admin/ai-settings/providers under the canonical key', async () => {
    mockedApiRequest.mockResolvedValueOnce([PROVIDER_FIXTURE]);
    const client = freshClient();

    const { result } = renderHook(() => useProviderConfigs(), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApiRequest).toHaveBeenCalledWith('/api/admin/ai-settings/providers');
    expect(result.current.data).toEqual([PROVIDER_FIXTURE]);
    expect(AI_SETTINGS_QUERY_KEY).toEqual(['admin', 'ai-settings', 'providers']);
    expect(client.getQueryData(AI_SETTINGS_QUERY_KEY)).toEqual([PROVIDER_FIXTURE]);
  });
});
