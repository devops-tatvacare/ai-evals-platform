import '@testing-library/jest-dom/vitest';
import { createElement, type ReactNode } from 'react';
import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Phase 14 — every test renders inside a QueryClientProvider by default so
 * components that call `useQuery` / `useQueryClient` (e.g. orchestration
 * pickers and the DynamicConfigForm WATI-template lookup) don't crash with
 * "No QueryClient set" inside vitest. Each `render` gets a fresh client so
 * tests stay isolated; per-test `wrapper` overrides still take precedence
 * (we re-wrap them so the QueryClientProvider always ends up at the top).
 *
 * Implementation: `vi.mock` the testing-library render to inject the
 * provider. We can't monkey-patch the named export at runtime because the
 * module's export descriptor is getter-only.
 */
vi.mock('@testing-library/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@testing-library/react')>();

  function makeQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
        mutations: { retry: false },
      },
    });
  }

  function wrapWithProviders(
    InnerWrapper?: React.ComponentType<{ children: ReactNode }>,
  ) {
    return function ProvidersWrapper({ children }: { children: ReactNode }) {
      const client = makeQueryClient();
      const wrapped = InnerWrapper
        ? createElement(InnerWrapper, null, children)
        : children;
      return createElement(QueryClientProvider, { client }, wrapped);
    };
  }

  function patchedRender(
    ui: Parameters<typeof actual.render>[0],
    options?: Parameters<typeof actual.render>[1],
  ) {
    const wrapper = wrapWithProviders(options?.wrapper);
    return actual.render(ui, { ...options, wrapper });
  }

  return {
    ...actual,
    render: patchedRender,
  };
});
