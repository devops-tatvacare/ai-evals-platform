/**
 * Global Settings Store
 * Shared settings across all apps (API keys, theme, model selections, timeouts)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeMode, LLMTimeoutSettings } from '@/types';
import { DEFAULT_MODEL } from '@/constants';

// Version to track settings updates
const GLOBAL_SETTINGS_VERSION = 2; // v2: Added timeout settings

// Default timeout settings
const defaultTimeouts: LLMTimeoutSettings = {
  textOnly: 60,
  withSchema: 90,
  withAudio: 180,
  withAudioAndSchema: 240,
};

export interface GlobalSettings {
  theme: ThemeMode;
  apiKey: string;
  selectedModels: {
    transcription: string;
    evaluation: string;
    extraction: string;
  };
  timeouts: LLMTimeoutSettings;
}

interface GlobalSettingsState extends GlobalSettings {
  _version: number;
  
  // Theme
  setTheme: (theme: ThemeMode) => void;
  
  // Authentication
  setApiKey: (apiKey: string) => void;
  
  // Model selections
  setSelectedModel: (type: 'transcription' | 'evaluation' | 'extraction', model: string) => void;
  setAllModels: (model: string) => void;
  
  // Timeouts
  setTimeouts: (timeouts: Partial<LLMTimeoutSettings>) => void;
  
  // Bulk update
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

const defaultGlobalSettings: GlobalSettings & { _version: number } = {
  _version: GLOBAL_SETTINGS_VERSION,
  theme: 'system',
  apiKey: '',
  selectedModels: {
    transcription: DEFAULT_MODEL,
    evaluation: DEFAULT_MODEL,
    extraction: DEFAULT_MODEL,
  },
  timeouts: defaultTimeouts,
};

export const useGlobalSettingsStore = create<GlobalSettingsState>()(
  persist(
    (set) => ({
      ...defaultGlobalSettings,

      setTheme: (theme) => set({ theme }),

      setApiKey: (apiKey) => set({ apiKey }),

      setSelectedModel: (type, model) =>
        set((state) => ({
          selectedModels: {
            ...state.selectedModels,
            [type]: model,
          },
        })),

      setAllModels: (model) =>
        set({
          selectedModels: {
            transcription: model,
            evaluation: model,
            extraction: model,
          },
        }),

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
          selectedModels: {
            ...state.selectedModels,
            ...updates.selectedModels,
          },
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
        
        // v2: Add timeouts if missing
        if (version < 2) {
          state.timeouts = defaultTimeouts;
        }
        
        return state;
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<GlobalSettingsState>;
        return {
          ...currentState,
          ...persisted,
          _version: GLOBAL_SETTINGS_VERSION,
          selectedModels: {
            ...currentState.selectedModels,
            ...persisted.selectedModels,
          },
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
