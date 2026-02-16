/**
 * Global Settings Store
 * Frontend-only settings shared across all apps: theme and timeouts.
 *
 * LLM credentials (API key, model) are in useSettingsStore (backend-persisted).
 * App-specific API credentials are in useAppSettingsStore (backend-persisted).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';

const GLOBAL_SETTINGS_VERSION = 3; // v3: Removed redundant apiKey/selectedModels

const defaultTimeouts: LLMTimeoutSettings = {
  textOnly: 60,
  withSchema: 90,
  withAudio: 180,
  withAudioAndSchema: 240,
};

export interface GlobalSettings {
  theme: ThemeMode;
  timeouts: LLMTimeoutSettings;
}

interface GlobalSettingsState extends GlobalSettings {
  _version: number;

  // Theme
  setTheme: (theme: ThemeMode) => void;

  // Timeouts
  setTimeouts: (timeouts: Partial<LLMTimeoutSettings>) => void;

  // Bulk update
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const defaultGlobalSettings: GlobalSettings & { _version: number } = {
  _version: GLOBAL_SETTINGS_VERSION,
  theme: 'system',
  timeouts: defaultTimeouts,
};

export const useGlobalSettingsStore = create<GlobalSettingsState>()(
  persist(
    (set) => ({
      ...defaultGlobalSettings,

      setTheme: (theme) => set({ theme }),

      setTimeouts: (timeouts) =>
        set((state) => ({
          timeouts: {
            ...state.timeouts,
            ...timeouts,
          },
        })),

      updateSettings: (updates) =>
        set((state) => ({
          ...state,
          ...updates,
          timeouts: {
            ...state.timeouts,
            ...updates.timeouts,
          },
        })),
    }),
    {
      name: 'global-settings',
      version: GLOBAL_SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        const state = persistedState as GlobalSettingsState;

        // v3: apiKey/selectedModels removed — just ensure timeouts exist
        if (version < 3) {
          state.timeouts = state.timeouts ?? defaultTimeouts;
        }

        return state;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<GlobalSettingsState>;
        return {
          ...currentState,
          ...persisted,
          _version: GLOBAL_SETTINGS_VERSION,
          timeouts: {
            textOnly: persisted.timeouts?.textOnly ?? currentState.timeouts.textOnly,
            withSchema: persisted.timeouts?.withSchema ?? currentState.timeouts.withSchema,
            withAudio: persisted.timeouts?.withAudio ?? currentState.timeouts.withAudio,
            withAudioAndSchema: persisted.timeouts?.withAudioAndSchema ?? currentState.timeouts.withAudioAndSchema,
          },
        };
      },
    }
  )
);
