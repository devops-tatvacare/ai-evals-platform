import { create } from 'zustand';
import type { AppSettings, ThemeMode, PerStepModelConfig } from '@/types';
import { DEFAULT_MODEL, DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_EXTRACTION_PROMPT, DEFAULT_EVALUATION_PROMPT } from '@/constants';
import { settingsRepository } from '@/services/api';

// Version to track prompt updates - increment when default prompts change significantly
const SETTINGS_VERSION = 9; // v9: Removed TranscriptionPreferences (moved to prerequisites)

// Read theme from localStorage so the store's initial value matches what
// the inline script in index.html already applied — prevents a flash of
// wrong theme while the async API load is in progress.
function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('ai-evals-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // Ignore localStorage errors (e.g., private browsing)
  }
  return 'system';
}

interface SettingsState extends AppSettings {
  _version?: number; // Internal version tracking
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setApiKey: (apiKey: string) => void;
  setSelectedModel: (model: string) => void;
  setTranscriptionPrompt: (prompt: string) => void;
  setEvaluationPrompt: (prompt: string) => void;
  setExtractionPrompt: (prompt: string) => void;
  resetPromptToDefault: (type: 'transcription' | 'evaluation' | 'extraction') => void;
  isPromptCustomized: (type: 'transcription' | 'evaluation' | 'extraction') => boolean;
  updateLLMSettings: (settings: Partial<AppSettings['llm']>) => void;
  setDefaultSchema: (promptType: 'transcription' | 'evaluation' | 'extraction', schemaId: string | null) => void;
  // Per-step model configuration (Part 5: unified pipeline support)
  setStepModel: (step: keyof PerStepModelConfig, model: string) => void;
  getStepModel: (step: keyof PerStepModelConfig) => string;
  // API persistence methods
  loadSettings: () => Promise<void>;
}

const defaultSettings: AppSettings & { _version: number; _hasHydrated: boolean } = {
  _version: SETTINGS_VERSION,
  _hasHydrated: false,
  theme: getInitialTheme(),
  llm: {
    provider: 'gemini',
    apiKey: '',
    selectedModel: DEFAULT_MODEL,
    transcriptionPrompt: DEFAULT_TRANSCRIPTION_PROMPT,
    evaluationPrompt: DEFAULT_EVALUATION_PROMPT,
    extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
    defaultSchemas: {
      transcription: null,
      evaluation: null,
      extraction: null,
    },
    defaultPrompts: {
      transcription: null,
      evaluation: null,
      extraction: null,
    },
  },
};

// Debounce helper for saving settings
let saveTimeout: ReturnType<typeof setTimeout>;
function debouncedSave(state: SettingsState) {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await settingsRepository.set(null, 'voice-rx-settings', {
        _version: state._version,
        theme: state.theme,
        llm: state.llm,
      });
    } catch (err) {
      console.error('[SettingsStore] Failed to save settings:', err);
    }
  }, 500);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaultSettings,

  loadSettings: async () => {
    try {
      const data = await settingsRepository.get(null, 'voice-rx-settings');
      if (data) {
        const persistedState = data as Partial<SettingsState>;

        // Merge with defaults
        const persisted = persistedState;
        const currentState = get();
        const persistedDefaults = persisted.llm?.defaultPrompts;
        const persistedStepModels = persisted.llm?.stepModels;
        const defaultModel = persisted.llm?.selectedModel || currentState.llm.selectedModel;

        const newState = {
          ...currentState,
          ...persisted,
          _version: SETTINGS_VERSION,
          _hasHydrated: true,
          llm: {
            ...currentState.llm,
            ...persisted.llm,
            defaultSchemas: {
              ...currentState.llm.defaultSchemas,
              ...persisted.llm?.defaultSchemas,
            },
            defaultPrompts: {
              transcription: persistedDefaults?.transcription ?? null,
              evaluation: persistedDefaults?.evaluation ?? null,
              extraction: persistedDefaults?.extraction ?? null,
            },
            // Merge stepModels, falling back to selectedModel for missing values
            stepModels: persistedStepModels ?? {
              normalization: defaultModel,
              transcription: defaultModel,
              evaluation: defaultModel,
            },
          },
        };

        // Update ONLY non-customized prompts to latest defaults
        if (newState.llm.defaultPrompts.transcription !== 'custom') {
          newState.llm.transcriptionPrompt = DEFAULT_TRANSCRIPTION_PROMPT;
        }
        if (newState.llm.defaultPrompts.evaluation !== 'custom') {
          newState.llm.evaluationPrompt = DEFAULT_EVALUATION_PROMPT;
        }
        if (newState.llm.defaultPrompts.extraction !== 'custom') {
          newState.llm.extractionPrompt = DEFAULT_EXTRACTION_PROMPT;
        }

        set(newState);
        console.log('[SettingsStore] Loaded settings from API. apiKey length:', newState.llm?.apiKey?.length || 0);
      } else {
        set({ _hasHydrated: true });
        console.log('[SettingsStore] No saved settings found, using defaults');
      }
    } catch (err) {
      console.error('[SettingsStore] Failed to load settings:', err);
      set({ _hasHydrated: true });
    }
  },

  setHasHydrated: (state) => {
    set({ _hasHydrated: state });
  },

  setTheme: (theme) => {
    set({ theme });
    debouncedSave(get());
  },

  setApiKey: (apiKey) => {
    console.log('[SettingsStore] setApiKey called with:', apiKey?.substring(0, 10) + '...');
    set((state) => {
      const newState = { llm: { ...state.llm, apiKey } };
      console.log('[SettingsStore] New state llm.apiKey:', newState.llm.apiKey?.substring(0, 10) + '...');
      return newState;
    });
    debouncedSave(get());
  },

  setSelectedModel: (selectedModel) => {
    set((state) => ({
      llm: { ...state.llm, selectedModel },
    }));
    debouncedSave(get());
  },

  setTranscriptionPrompt: (transcriptionPrompt) => {
    set((state) => ({
      llm: {
        ...state.llm,
        transcriptionPrompt,
        defaultPrompts: {
          transcription: 'custom',
          evaluation: state.llm.defaultPrompts?.evaluation || null,
          extraction: state.llm.defaultPrompts?.extraction || null,
        }
      },
    }));
    debouncedSave(get());
  },

  setEvaluationPrompt: (evaluationPrompt) => {
    set((state) => ({
      llm: {
        ...state.llm,
        evaluationPrompt,
        defaultPrompts: {
          transcription: state.llm.defaultPrompts?.transcription || null,
          evaluation: 'custom',
          extraction: state.llm.defaultPrompts?.extraction || null,
        }
      },
    }));
    debouncedSave(get());
  },

  setExtractionPrompt: (extractionPrompt) => {
    set((state) => ({
      llm: {
        ...state.llm,
        extractionPrompt,
        defaultPrompts: {
          transcription: state.llm.defaultPrompts?.transcription || null,
          evaluation: state.llm.defaultPrompts?.evaluation || null,
          extraction: 'custom',
        }
      },
    }));
    debouncedSave(get());
  },

  resetPromptToDefault: (type) => {
    set((state) => {
      const promptUpdates = {
        transcription: { transcriptionPrompt: DEFAULT_TRANSCRIPTION_PROMPT },
        evaluation: { evaluationPrompt: DEFAULT_EVALUATION_PROMPT },
        extraction: { extractionPrompt: DEFAULT_EXTRACTION_PROMPT },
      };
      return {
        llm: {
          ...state.llm,
          ...promptUpdates[type],
          defaultPrompts: {
            transcription: type === 'transcription' ? null : (state.llm.defaultPrompts?.transcription || null),
            evaluation: type === 'evaluation' ? null : (state.llm.defaultPrompts?.evaluation || null),
            extraction: type === 'extraction' ? null : (state.llm.defaultPrompts?.extraction || null),
          }
        },
      };
    });
    debouncedSave(get());
  },

  isPromptCustomized: (type) => {
    const { llm } = get();
    return llm.defaultPrompts?.[type] === 'custom';
  },

  updateLLMSettings: (settings) => {
    set((state) => ({
      llm: { ...state.llm, ...settings },
    }));
    debouncedSave(get());
  },

  setDefaultSchema: (promptType, schemaId) => {
    set((state) => ({
      llm: {
        ...state.llm,
        defaultSchemas: {
          ...(state.llm.defaultSchemas || defaultSettings.llm.defaultSchemas),
          [promptType]: schemaId,
        },
      },
    }));
    debouncedSave(get());
  },

  // Per-step model configuration (Part 5: unified pipeline support)
  setStepModel: (step, model) => {
    set((state) => ({
      llm: {
        ...state.llm,
        stepModels: {
          ...(state.llm.stepModels || {
            normalization: state.llm.selectedModel,
            transcription: state.llm.selectedModel,
            evaluation: state.llm.selectedModel,
          }),
          [step]: model,
        },
      },
    }));
    debouncedSave(get());
  },

  getStepModel: (step) => {
    const { llm } = get();
    return llm.stepModels?.[step] || llm.selectedModel;
  },
}));
