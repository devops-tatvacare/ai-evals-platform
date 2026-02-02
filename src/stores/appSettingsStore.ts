/**
 * App-Specific Settings Store
 * Per-app settings that are isolated between Voice Rx and Kaira Bot
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppId } from '@/types';

// Version to track settings updates
const APP_SETTINGS_VERSION = 1;

// Voice Rx specific settings
export interface VoiceRxSettings {
  languageHint: string;
  scriptType: 'auto' | 'devanagari' | 'romanized' | 'original';
  preserveCodeSwitching: boolean;
}

// Kaira Bot specific settings
export interface KairaBotSettings {
  contextWindowSize: number;
  maxResponseLength: number;
  historyRetentionDays: number;
  streamResponses: boolean;
  kairaChatUserId?: string;  // User ID for Kaira chat API
}

// All app-specific settings
export interface AppSpecificSettings {
  'voice-rx': VoiceRxSettings;
  'kaira-bot': KairaBotSettings;
}

// Default settings for each app
const defaultVoiceRxSettings: VoiceRxSettings = {
  languageHint: '',
  scriptType: 'auto',
  preserveCodeSwitching: true,
};

const defaultKairaBotSettings: KairaBotSettings = {
  contextWindowSize: 4096,
  maxResponseLength: 2048,
  historyRetentionDays: 30,
  streamResponses: true,
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
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      _version: APP_SETTINGS_VERSION,
      settings: {
        'voice-rx': defaultVoiceRxSettings,
        'kaira-bot': defaultKairaBotSettings,
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
    }),
    {
      name: 'app-settings',
      version: APP_SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        const state = persistedState as AppSettingsState;
        
        // Future migrations can be added here
        if (version < APP_SETTINGS_VERSION) {
          // Migration logic
        }
        
        return state;
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
