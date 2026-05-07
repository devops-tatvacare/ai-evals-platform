import { lazy, Suspense, useEffect } from 'react';
import { Toaster } from 'sonner';
import { QueryClientProvider } from '@tanstack/react-query';

import { ThemeProvider } from './ThemeProvider';
import { useAuthStore } from '@/stores/authStore';
import { useLLMSettingsStore } from '@/stores/llmSettingsStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { queryClient } from '@/features/orchestration/queries/queryClient';

// Phase 14 — devtools live behind a dev-only dynamic import so production
// bundles never see them. Vite tree-shakes the import out when
// `import.meta.env.DEV` is statically false.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(async () => {
      const mod = await import('@tanstack/react-query-devtools');
      return { default: mod.ReactQueryDevtools };
    })
  : null;

function loadAllStores() {
  useLLMSettingsStore.getState().loadSettings();
  useAppSettingsStore.getState().loadCredentialsFromBackend('voice-rx');
  useAppSettingsStore.getState().loadCredentialsFromBackend('kaira-bot');
}

export function Providers({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Bootstrap auth on mount
  useEffect(() => {
    useAuthStore.getState().loadUser();
  }, []);

  // Load data stores whenever auth becomes true (initial load or post-login)
  useEffect(() => {
    if (isAuthenticated) {
      loadAllStores();
    }
  }, [isAuthenticated]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              borderRadius: '6px',
              fontSize: '13px',
            },
          }}
          visibleToasts={3}
        />
        {ReactQueryDevtools ? (
          <Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} />
          </Suspense>
        ) : null}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
