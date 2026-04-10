import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './ThemeProvider';
import { useAuthStore } from '@/stores/authStore';
import { useLLMSettingsStore } from '@/stores/llmSettingsStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';

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
    </ThemeProvider>
  );
}
