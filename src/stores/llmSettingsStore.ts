/**
 * LLM Settings Store
 * Backend-persisted settings for LLM configuration.
 *
 * Saved to key: "llm-settings" with app_id="" (global).
 * No theme, no inline prompt text — prompts resolve via resolvePromptText().
 */

import { create } from 'zustand';
import type { LLMSettings, LLMProvider, PerStepModelConfig } from '@/types';
import { DEFAULT_MODEL } from '@/constants';
import { settingsRepository } from '@/services/api';

type PromptType = 'transcription' | 'evaluation' | 'extraction';

const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o',
};

const defaultLLMSettings: LLMSettings = {
  provider: 'gemini',
  apiKey: '',
  geminiApiKey: '',
  openaiApiKey: '',
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
  /** Switch active provider, reset model to provider default, recompute apiKey */
  setProvider: (provider: LLMProvider) => void;
  /** Set API key for a specific provider */
  setProviderApiKey: (provider: LLMProvider, key: string) => void;

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
        const provider = data.provider || 'gemini';
        const geminiApiKey = data.geminiApiKey || '';
        const openaiApiKey = data.openaiApiKey || '';
        const apiKey = provider === 'openai' ? openaiApiKey : geminiApiKey;

        set({
          ...defaultLLMSettings,
          ...data,
          provider,
          geminiApiKey,
          openaiApiKey,
          apiKey,
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
      } else {
        set({ _hasHydrated: true });
      }
    } catch (err) {
      console.error('[LLMSettingsStore] Failed to load settings:', err);
      set({ _hasHydrated: true });
    }
  },

  save: async () => {
    const state = get();
    const settings: LLMSettings = {
      provider: state.provider,
      apiKey: state.apiKey,
      geminiApiKey: state.geminiApiKey,
      openaiApiKey: state.openaiApiKey,
      selectedModel: state.selectedModel,
      activeSchemaIds: state.activeSchemaIds,
      activePromptIds: state.activePromptIds,
      stepModels: state.stepModels,
    };
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

  setProvider: (provider) => {
    const state = get();
    const defaultModel = PROVIDER_DEFAULT_MODELS[provider];
    const apiKey = provider === 'openai' ? state.openaiApiKey : state.geminiApiKey;
    set({ provider, selectedModel: defaultModel, apiKey });
  },

  setProviderApiKey: (provider, key) => {
    const updates: Partial<LLMSettingsState> = {};
    if (provider === 'gemini') {
      updates.geminiApiKey = key;
    } else {
      updates.openaiApiKey = key;
    }
    // If this is the active provider, also update apiKey
    if (get().provider === provider) {
      updates.apiKey = key;
    }
    set(updates);
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
