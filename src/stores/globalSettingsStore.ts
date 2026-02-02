/**
 * Global Settings Store
 * Shared settings across all apps (API keys, theme, model selections)
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeMode } from '@/types';
import { DEFAULT_MODEL } from '@/constants';

// Version to track settings updates
const GLOBAL_SETTINGS_VERSION = 1;

export interface GlobalSettings {
  theme: ThemeMode;
  apiKey: string;
  selectedModels: {
    transcription: string;
    evaluation: string;
    extraction: string;
  };
}

interface GlobalSettingsState extends GlobalSettings {
  _version: number;
  
  // Theme
  setTheme: (theme: ThemeMode) => void;
  
  // API Key
  setApiKey: (apiKey: string) => void;
  
  // Model selections
  setSelectedModel: (type: 'transcription' | 'evaluation' | 'extraction', model: string) => void;
  setAllModels: (model: string) => void;
  
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

      updateSettings: (updates) =>
        set((state) => ({
          ...state,
          ...updates,
          selectedModels: {
            ...state.selectedModels,
            ...updates.selectedModels,
          },
        })),
    }),
    {
      name: 'global-settings',
      version: GLOBAL_SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        const state = persistedState as GlobalSettingsState;
        
        // Future migrations can be added here
        if (version < GLOBAL_SETTINGS_VERSION) {
          // Migration logic
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
        };
      },
    }
  )
);
