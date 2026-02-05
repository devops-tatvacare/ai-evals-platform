import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import type { AppSettings, ThemeMode, TranscriptionPreferences, LLMTimeoutSettings } from '@/types';
import { DEFAULT_MODEL, DEFAULT_TRANSCRIPTION_PROMPT, DEFAULT_EXTRACTION_PROMPT, DEFAULT_EVALUATION_PROMPT } from '@/constants';
import { saveEntity, getEntity } from '@/services/storage/db';

// Version to track prompt updates - increment when default prompts change significantly
const SETTINGS_VERSION = 7; // v7: Added configurable LLM timeout settings

/**
 * Custom Zustand storage that uses entities table instead of localStorage
 */
const indexedDbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      // name will be 'voice-rx-settings'
      // We store entire settings state as one entity with appId=null (global)
      const entity = await getEntity('setting', null, name);
      return entity?.data.value as string || null;
    } catch (error) {
      console.error('[Settings] Error loading from IndexedDB:', error);
      return null;
    }
  },
  
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const existing = await getEntity('setting', null, name);
      await saveEntity({
        id: existing?.id,
        appId: null,
        type: 'setting',
        key: name,
        version: null,
        data: { value },
      });
    } catch (error) {
      console.error('[Settings] Error saving to IndexedDB:', error);
    }
  },
  
  removeItem: async (name: string): Promise<void> => {
    try {
      const existing = await getEntity('setting', null, name);
      if (existing?.id) {
        const { db } = await import('@/services/storage/db');
        await db.entities.delete(existing.id);
      }
    } catch (error) {
      console.error('[Settings] Error removing from IndexedDB:', error);
    }
  },
};

// Default transcription preferences
const defaultTranscriptionPreferences: TranscriptionPreferences = {
  scriptPreference: 'auto',
  languageHint: '',
  preserveCodeSwitching: true,
};

// Default timeout settings (in seconds for UI)
const defaultTimeoutSettings: LLMTimeoutSettings = {
  textOnly: 60,
  withSchema: 90,
  withAudio: 180,
  withAudioAndSchema: 240,
};

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
  // New transcription preference setters
  updateTranscriptionPreferences: (prefs: Partial<TranscriptionPreferences>) => void;
  resetTranscriptionPreferences: () => void;
}

const defaultSettings: AppSettings & { _version: number; _hasHydrated: boolean } = {
  _version: SETTINGS_VERSION,
  _hasHydrated: false,
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
    timeouts: defaultTimeoutSettings,
  },
  transcription: defaultTranscriptionPreferences,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      
      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
      
      setTheme: (theme) => set({ theme }),
      
      setApiKey: (apiKey) => {
        console.log('[SettingsStore] setApiKey called with:', apiKey?.substring(0, 10) + '...');
        set((state) => {
          const newState = { llm: { ...state.llm, apiKey } };
          console.log('[SettingsStore] New state llm.apiKey:', newState.llm.apiKey?.substring(0, 10) + '...');
          return newState;
        });
      },
      
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
      storage: createJSONStorage(() => indexedDbStorage),  // Use IndexedDB instead of localStorage
      version: SETTINGS_VERSION,
      onRehydrateStorage: () => {
        console.log('[SettingsStore] Starting rehydration...');
        return (state, error) => {
          if (error) {
            console.error('[SettingsStore] Rehydration error:', error);
          } else {
            console.log('[SettingsStore] Rehydrated successfully. apiKey length:', state?.llm?.apiKey?.length || 0);
            state?.setHasHydrated(true);
          }
        };
      },
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
            timeouts: {
              textOnly: persisted.llm?.timeouts?.textOnly ?? currentState.llm.timeouts?.textOnly ?? defaultTimeoutSettings.textOnly,
              withSchema: persisted.llm?.timeouts?.withSchema ?? currentState.llm.timeouts?.withSchema ?? defaultTimeoutSettings.withSchema,
              withAudio: persisted.llm?.timeouts?.withAudio ?? currentState.llm.timeouts?.withAudio ?? defaultTimeoutSettings.withAudio,
              withAudioAndSchema: persisted.llm?.timeouts?.withAudioAndSchema ?? currentState.llm.timeouts?.withAudioAndSchema ?? defaultTimeoutSettings.withAudioAndSchema,
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
