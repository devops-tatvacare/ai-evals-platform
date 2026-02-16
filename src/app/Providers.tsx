import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './ThemeProvider';
import { BackgroundTaskIndicator } from '@/components/feedback';
import { useSettingsStore } from '@/stores/settingsStore';

export function Providers({ children }: { children: React.ReactNode }) {
  // Load settings from API on app startup
  useEffect(() => {
    useSettingsStore.getState().loadSettings();
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
