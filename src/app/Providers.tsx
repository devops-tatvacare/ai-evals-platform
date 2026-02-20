import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ThemeProvider } from './ThemeProvider';
import { useLLMSettingsStore } from '@/stores/llmSettingsStore';
import { useAppSettingsStore } from '@/stores/appSettingsStore';
import { usePromptsStore } from '@/stores/promptsStore';

export function Providers({ children }: { children: React.ReactNode }) {
  // Load all settings from backend on app startup
  useEffect(() => {
    useLLMSettingsStore.getState().loadSettings();
    useAppSettingsStore.getState().loadCredentialsFromBackend('voice-rx');
    useAppSettingsStore.getState().loadCredentialsFromBackend('kaira-bot');
    // Load prompts so resolvePromptText() has data available
    usePromptsStore.getState().loadPrompts('voice-rx');
    usePromptsStore.getState().loadPrompts('kaira-bot');
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
