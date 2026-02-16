import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './ThemeProvider';
import { BackgroundTaskIndicator } from '@/components/feedback';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';

export function Providers({ children }: { children: React.ReactNode }) {
  // Load all settings from backend on app startup
  useEffect(() => {
    useSettingsStore.getState().loadSettings();
    useAppSettingsStore.getState().loadCredentialsFromBackend('voice-rx');
    useAppSettingsStore.getState().loadCredentialsFromBackend('kaira-bot');
  }, []);

  return (
    <ThemeProvider>
      {children}
      <BackgroundTaskIndicator />
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
