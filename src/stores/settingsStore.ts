import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings, ThemeMode, TranscriptionPreferences } from '@/types';
import { DEFAULT_MODEL, DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_EXTRACTION_PROMPT, DEFAULT_EVALUATION_PROMPT } from '@/constants';

// Version to track prompt updates - increment when default prompts change significantly
const SETTINGS_VERSION = 3; // v3: Added multilingual transcription preferences

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

// Check if a prompt looks like the old "human-verified" version
function isOldEvaluationPrompt(prompt: string): boolean {
  return prompt.includes('Human-Verified') || 
         prompt.includes('human-verified') ||
         prompt.includes('GROUND TRUTH TRANSCRIPT (Human-Verified)');
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      
      setTheme: (theme) => set({ theme }),
      
      setApiKey: (apiKey) => set((state) => ({
        llm: { ...state.llm, apiKey },
      })),
      
      setSelectedModel: (selectedModel) => set((state) => ({
        llm: { ...state.llm, selectedModel },
      })),

      setTranscriptionPrompt: (transcriptionPrompt) => set((state) => ({
        llm: { ...state.llm, transcriptionPrompt },
      })),

      setEvaluationPrompt: (evaluationPrompt) => set((state) => ({
        llm: { ...state.llm, evaluationPrompt },
      })),

      setExtractionPrompt: (extractionPrompt) => set((state) => ({
        llm: { ...state.llm, extractionPrompt },
      })),

      resetPromptToDefault: (type) => set((state) => ({
        llm: {
          ...state.llm,
          ...(type === 'transcription'
            ? { transcriptionPrompt: DEFAULT_TRANSCRIPTION_PROMPT }
            : type === 'evaluation'
            ? { evaluationPrompt: DEFAULT_EVALUATION_PROMPT }
            : { extractionPrompt: DEFAULT_EXTRACTION_PROMPT }),
        },
      })),
      
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
      migrate: (persistedState, version) => {
        const state = persistedState as SettingsState;
        
        // Migration from v1 (or no version) to v2: Update evaluation prompt if it's the old one
        if (version < 2) {
          if (state.llm?.evaluationPrompt && isOldEvaluationPrompt(state.llm.evaluationPrompt)) {
            state.llm.evaluationPrompt = DEFAULT_EVALUATION_PROMPT;
          }
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
