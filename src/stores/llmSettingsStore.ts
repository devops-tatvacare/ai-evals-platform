/**
 * LLM Settings Store
 * Backend-persisted settings for LLM configuration.
 *
 * Saved to key: "llm-settings" with app_id="" (global).
 * No theme, no inline prompt text — prompts resolve via resolvePromptText().
 */

import { create } from 'zustand';
import type { LLMSettings, PerStepModelConfig } from '@/types';
import { DEFAULT_MODEL } from '@/constants';
import { settingsRepository } from '@/services/api';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

const defaultLLMSettings: LLMSettings = {
  provider: 'gemini',
  apiKey: '',
  selectedModel: DEFAULT_MODEL,
  activeSchemaIds: {
    transcription: null,
    evaluation: null,
    extraction: null,
  },
  activePromptIds: {
    transcription: null,
    evaluation: null,
    extraction: null,
  },
  stepModels: {
    normalization: DEFAULT_MODEL,
    transcription: DEFAULT_MODEL,
    evaluation: DEFAULT_MODEL,
  },
};

interface LLMSettingsState extends LLMSettings {
  _hasHydrated: boolean;

  // Setters — update in-memory only (call save() to persist)
  setApiKey: (key: string) => void;
  setSelectedModel: (model: string) => void;
  setStepModel: (step: keyof PerStepModelConfig, model: string) => void;
  setActivePromptId: (type: PromptType, id: string | null) => void;
  setActiveSchemaId: (type: PromptType, id: string | null) => void;
  updateLLMSettings: (updates: Partial<LLMSettings>) => void;

  // Persistence
  save: () => Promise<void>;
  loadSettings: () => Promise<void>;
}

export const useLLMSettingsStore = create<LLMSettingsState>((set, get) => ({
  ...defaultLLMSettings,
  _hasHydrated: false,

  loadSettings: async () => {
    try {
      const data = await settingsRepository.get('', 'llm-settings') as Partial<LLMSettings> | undefined;
      if (data) {
        const defaultModel = data.selectedModel || defaultLLMSettings.selectedModel;
        set({
          ...defaultLLMSettings,
          ...data,
          activeSchemaIds: {
            ...defaultLLMSettings.activeSchemaIds,
            ...data.activeSchemaIds,
          },
          activePromptIds: {
            ...defaultLLMSettings.activePromptIds,
            ...data.activePromptIds,
          },
          stepModels: data.stepModels ?? {
            normalization: defaultModel,
            transcription: defaultModel,
            evaluation: defaultModel,
          },
          _hasHydrated: true,
        });
        console.log('[LLMSettingsStore] Loaded settings. apiKey length:', data.apiKey?.length || 0);
      } else {
        set({ _hasHydrated: true });
        console.log('[LLMSettingsStore] No saved settings found, using defaults');
      }
    } catch (err) {
      console.error('[LLMSettingsStore] Failed to load settings:', err);
      set({ _hasHydrated: true });
    }
  },

  save: async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _hasHydrated, setApiKey, setSelectedModel, setStepModel, setActivePromptId, setActiveSchemaId, updateLLMSettings, save, loadSettings, ...settings } = get();
    await settingsRepository.set('', 'llm-settings', settings);
  },

  setApiKey: (apiKey) => {
    set({ apiKey });
  },

  setSelectedModel: (selectedModel) => {
    set({ selectedModel });
  },

  setStepModel: (step, model) => {
    set((state) => ({
      stepModels: {
        ...state.stepModels,
        [step]: model,
      },
    }));
  },

  setActivePromptId: (type, id) => {
    set((state) => ({
      activePromptIds: {
        ...state.activePromptIds,
        [type]: id,
      },
    }));
  },

  setActiveSchemaId: (type, id) => {
    set((state) => ({
      activeSchemaIds: {
        ...state.activeSchemaIds,
        [type]: id,
      },
    }));
  },

  updateLLMSettings: (updates) => {
    set((state) => ({
      ...state,
      ...updates,
      activeSchemaIds: {
        ...state.activeSchemaIds,
        ...updates.activeSchemaIds,
      },
      activePromptIds: {
        ...state.activePromptIds,
        ...updates.activePromptIds,
      },
      stepModels: {
        ...state.stepModels,
        ...updates.stepModels,
      },
    }));
  },
}));
