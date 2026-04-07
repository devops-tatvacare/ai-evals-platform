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
  // Load auth first, then app data only if authenticated
  useEffect(() => {
    useAuthStore.getState().loadUser().then(() => {
      if (useAuthStore.getState().isAuthenticated) {
        loadAllStores();
      }
    });
  }, []);

  return (
    <ThemeProvider>
      {children}
      <Toaster
        position="bottom-right"
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
