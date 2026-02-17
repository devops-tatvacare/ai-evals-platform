/**
 * App-Specific Settings Store
 * Per-app settings that are isolated between Voice Rx and Kaira Bot.
 *
 * Non-sensitive prefs (languageHint, contextWindow, etc.) persist in localStorage.
 * API credentials persist in the backend database via settingsRepository.
 * On startup, Providers.tsx calls loadCredentialsFromBackend() which overwrites
 * any stale localStorage values with the backend's source-of-truth.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppId } from '@/types';
import { settingsRepository } from '@/services/api';

// Version to track settings shape changes
const APP_SETTINGS_VERSION = 4; // v4: Clean slate (settings refactor)

// Voice Rx specific settings
export interface VoiceRxSettings {
  languageHint: string;
  scriptType: 'auto' | 'devanagari' | 'romanized' | 'original';
  preserveCodeSwitching: boolean;
  // Voice RX transcription API
  voiceRxApiUrl: string;
  voiceRxApiKey: string;
}

// Kaira Bot specific settings
export interface KairaBotSettings {
  contextWindowSize: number;
  maxResponseLength: number;
  historyRetentionDays: number;
  streamResponses: boolean;
  kairaChatUserId: string;
  // Kaira API
  kairaApiUrl: string;
  kairaAuthToken: string;
}

// Kaira Evals placeholder (no specific settings yet)
export interface KairaEvalsSettings {
  // Reserved for future use
}

// All app-specific settings
export interface AppSpecificSettings {
  'voice-rx': VoiceRxSettings;
  'kaira-bot': KairaBotSettings;
  'kaira-evals': KairaEvalsSettings;
}

// New installs start with empty credentials — user must configure via Settings.
const defaultVoiceRxSettings: VoiceRxSettings = {
  languageHint: '',
  scriptType: 'auto',
  preserveCodeSwitching: true,
  voiceRxApiUrl: '',
  voiceRxApiKey: '',
};

const defaultKairaBotSettings: KairaBotSettings = {
  contextWindowSize: 4096,
  maxResponseLength: 2048,
  historyRetentionDays: 30,
  streamResponses: true,
  kairaChatUserId: '',
  kairaApiUrl: '',
  kairaAuthToken: '',
};

interface AppSettingsState {
  _version: number;
  settings: AppSpecificSettings;

  // Voice Rx setters
  updateVoiceRxSettings: (updates: Partial<VoiceRxSettings>) => void;
  resetVoiceRxSettings: () => void;

  // Kaira Bot setters
  updateKairaBotSettings: (updates: Partial<KairaBotSettings>) => void;
  resetKairaBotSettings: () => void;

  // Generic getter
  getAppSettings: <T extends AppId>(appId: T) => AppSpecificSettings[T];

  // Backend persistence for credentials
  loadCredentialsFromBackend: (appId: AppId) => Promise<void>;
  saveCredentialsToBackend: (appId: AppId) => Promise<void>;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      _version: APP_SETTINGS_VERSION,
      settings: {
        'voice-rx': defaultVoiceRxSettings,
        'kaira-bot': defaultKairaBotSettings,
        'kaira-evals': {},
      },

      updateVoiceRxSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            'voice-rx': {
              ...state.settings['voice-rx'],
              ...updates,
            },
          },
        })),

      resetVoiceRxSettings: () =>
        set((state) => ({
          settings: {
            ...state.settings,
            'voice-rx': defaultVoiceRxSettings,
          },
        })),

      updateKairaBotSettings: (updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            'kaira-bot': {
              ...state.settings['kaira-bot'],
              ...updates,
            },
          },
        })),

      resetKairaBotSettings: () =>
        set((state) => ({
          settings: {
            ...state.settings,
            'kaira-bot': defaultKairaBotSettings,
          },
        })),

      getAppSettings: (appId) => get().settings[appId],

      /**
       * Load API credentials from the backend settings table.
       * Called on app startup and on settings page mount.
       */
      loadCredentialsFromBackend: async (appId: AppId) => {
        try {
          const data = await settingsRepository.get(appId, 'api-credentials') as Record<string, string> | undefined;
          if (!data) return;

          if (appId === 'voice-rx') {
            set((state) => ({
              settings: {
                ...state.settings,
                'voice-rx': {
                  ...state.settings['voice-rx'],
                  ...(data.voiceRxApiUrl !== undefined && { voiceRxApiUrl: data.voiceRxApiUrl }),
                  ...(data.voiceRxApiKey !== undefined && { voiceRxApiKey: data.voiceRxApiKey }),
                },
              },
            }));
          } else if (appId === 'kaira-bot') {
            set((state) => ({
              settings: {
                ...state.settings,
                'kaira-bot': {
                  ...state.settings['kaira-bot'],
                  ...(data.kairaApiUrl !== undefined && { kairaApiUrl: data.kairaApiUrl }),
                  ...(data.kairaAuthToken !== undefined && { kairaAuthToken: data.kairaAuthToken }),
                  ...(data.kairaChatUserId !== undefined && { kairaChatUserId: data.kairaChatUserId }),
                },
              },
            }));
          }
        } catch (err) {
          console.error(`[AppSettingsStore] Failed to load ${appId} credentials:`, err);
        }
      },

      /**
       * Save API credentials to the backend settings table.
       * Called from settings pages on save.
       */
      saveCredentialsToBackend: async (appId: AppId) => {
        try {
          const state = get();

          if (appId === 'voice-rx') {
            const s = state.settings['voice-rx'];
            await settingsRepository.set('voice-rx', 'api-credentials', {
              voiceRxApiUrl: s.voiceRxApiUrl,
              voiceRxApiKey: s.voiceRxApiKey,
            });
          } else if (appId === 'kaira-bot') {
            const s = state.settings['kaira-bot'];
            await settingsRepository.set('kaira-bot', 'api-credentials', {
              kairaApiUrl: s.kairaApiUrl,
              kairaAuthToken: s.kairaAuthToken,
              kairaChatUserId: s.kairaChatUserId,
            });
          }
        } catch (err) {
          console.error(`[AppSettingsStore] Failed to save ${appId} credentials:`, err);
          throw err; // Re-throw so the settings page can show an error
        }
      },
    }),
    {
      name: 'app-settings',
      version: APP_SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: () => {
        // v4: Clean wipe — return fresh defaults
        return {
          _version: APP_SETTINGS_VERSION,
          settings: {
            'voice-rx': defaultVoiceRxSettings,
            'kaira-bot': defaultKairaBotSettings,
            'kaira-evals': {},
          },
        } as AppSettingsState;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AppSettingsState>;
        return {
          ...currentState,
          _version: APP_SETTINGS_VERSION,
          settings: {
            'voice-rx': {
              ...currentState.settings['voice-rx'],
              ...persisted.settings?.['voice-rx'],
            },
            'kaira-bot': {
              ...currentState.settings['kaira-bot'],
              ...persisted.settings?.['kaira-bot'],
            },
            'kaira-evals': {
              ...persisted.settings?.['kaira-evals'],
            },
          },
        };
      },
    }
  )
);

// Convenience hook for Voice Rx settings
export function useVoiceRxSettings() {
  const settings = useAppSettingsStore((state) => state.settings['voice-rx']);
  const updateSettings = useAppSettingsStore((state) => state.updateVoiceRxSettings);
  const resetSettings = useAppSettingsStore((state) => state.resetVoiceRxSettings);
  return { settings, updateSettings, resetSettings };
}

// Convenience hook for Kaira Bot settings
export function useKairaBotSettings() {
  const settings = useAppSettingsStore((state) => state.settings['kaira-bot']);
  const updateSettings = useAppSettingsStore((state) => state.updateKairaBotSettings);
  const resetSettings = useAppSettingsStore((state) => state.resetKairaBotSettings);
  return { settings, updateSettings, resetSettings };
}
