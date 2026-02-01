import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings, ThemeMode, TranscriptionPreferences } from '@/types';
import { DEFAULT_MODEL, DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_EXTRACTION_PROMPT, DEFAULT_EVALUATION_PROMPT } from '@/constants';

// Version to track prompt updates - increment when default prompts change significantly
const SETTINGS_VERSION = 6; // v6: Evaluation prompt now requests assessmentReferences for clickable navigation

// Default transcription preferences
const defaultTranscriptionPreferences: TranscriptionPreferences = {
  scriptPreference: 'auto',
  languageHint: '',
  preserveCodeSwitching: true,
};

interface SettingsState extends AppSettings {
  _version?: number; // Internal version tracking
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
  // New transcription preference setters
  updateTranscriptionPreferences: (prefs: Partial<TranscriptionPreferences>) => void;
  resetTranscriptionPreferences: () => void;
}

const defaultSettings: AppSettings & { _version: number } = {
  _version: SETTINGS_VERSION,
  theme: 'system',
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
  transcription: defaultTranscriptionPreferences,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      
      setTheme: (theme) => set({ theme }),
      
      setApiKey: (apiKey) => set((state) => ({
        llm: { ...state.llm, apiKey },
      })),
      
      setSelectedModel: (selectedModel) => set((state) => ({
        llm: { ...state.llm, selectedModel },
      })),

      setTranscriptionPrompt: (transcriptionPrompt) => set((state) => ({
        llm: { 
          ...state.llm, 
          transcriptionPrompt,
          defaultPrompts: {
            transcription: 'custom',
            evaluation: state.llm.defaultPrompts?.evaluation || null,
            extraction: state.llm.defaultPrompts?.extraction || null,
          }
        },
      })),

      setEvaluationPrompt: (evaluationPrompt) => set((state) => ({
        llm: { 
          ...state.llm, 
          evaluationPrompt,
          defaultPrompts: {
            transcription: state.llm.defaultPrompts?.transcription || null,
            evaluation: 'custom',
            extraction: state.llm.defaultPrompts?.extraction || null,
          }
        },
      })),

      setExtractionPrompt: (extractionPrompt) => set((state) => ({
        llm: { 
          ...state.llm, 
          extractionPrompt,
          defaultPrompts: {
            transcription: state.llm.defaultPrompts?.transcription || null,
            evaluation: state.llm.defaultPrompts?.evaluation || null,
            extraction: 'custom',
          }
        },
      })),

      resetPromptToDefault: (type) => set((state) => {
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
      }),
      
      isPromptCustomized: (type) => {
        const { llm } = get();
        return llm.defaultPrompts?.[type] === 'custom';
      },
      
      updateLLMSettings: (settings) => set((state) => ({
        llm: { ...state.llm, ...settings },
      })),

      setDefaultSchema: (promptType, schemaId) => set((state) => ({
        llm: {
          ...state.llm,
          defaultSchemas: {
            ...(state.llm.defaultSchemas || defaultSettings.llm.defaultSchemas),
            [promptType]: schemaId,
          },
        },
      })),

      // Transcription preference setters
      updateTranscriptionPreferences: (prefs) => set((state) => ({
        transcription: { ...state.transcription, ...prefs },
      })),

      resetTranscriptionPreferences: () => set({
        transcription: defaultTranscriptionPreferences,
      }),
    }),
    {
      name: 'voice-rx-settings',
      version: SETTINGS_VERSION,
      // Migrate old settings to new version
      migrate: (persistedState, _version) => {
        const state = persistedState as SettingsState;
        
        // Ensure defaultPrompts structure exists
        if (!state.llm) {
          state.llm = defaultSettings.llm;
        }
        if (!state.llm.defaultPrompts) {
          state.llm.defaultPrompts = {
            transcription: null,
            evaluation: null,
            extraction: null,
          };
        }
        
        // Update ONLY non-customized prompts to latest defaults
        // This scales forever - no version checks needed
        if (state.llm.defaultPrompts.transcription !== 'custom') {
          state.llm.transcriptionPrompt = DEFAULT_TRANSCRIPTION_PROMPT;
        }
        if (state.llm.defaultPrompts.evaluation !== 'custom') {
          state.llm.evaluationPrompt = DEFAULT_EVALUATION_PROMPT;
        }
        if (state.llm.defaultPrompts.extraction !== 'custom') {
          state.llm.extractionPrompt = DEFAULT_EXTRACTION_PROMPT;
        }
        
        return state;
      },
      // Merge persisted state with defaults to handle new fields
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SettingsState>;
        const persistedDefaults = persisted.llm?.defaultPrompts;
        return {
          ...currentState,
          ...persisted,
          _version: SETTINGS_VERSION,
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
          },
          transcription: {
            ...currentState.transcription,
            ...persisted.transcription,
          },
        };
      },
    }
  )
);
