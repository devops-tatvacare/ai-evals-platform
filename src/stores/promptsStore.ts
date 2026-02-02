import { create } from 'zustand';
import type { PromptDefinition, AppId } from '@/types';
import { promptsRepository } from '@/services/storage';

interface PromptsState {
  // Prompts keyed by appId
  prompts: Record<AppId, PromptDefinition[]>;
  isLoading: boolean;
  error: string | null;

  loadPrompts: (appId: AppId, promptType?: PromptDefinition['promptType']) => Promise<void>;
  getPrompt: (appId: AppId, id: string) => PromptDefinition | undefined;
  getPromptsByType: (appId: AppId, promptType: PromptDefinition['promptType']) => PromptDefinition[];
  savePrompt: (appId: AppId, prompt: Partial<PromptDefinition> & { promptType: PromptDefinition['promptType']; prompt: string }) => Promise<PromptDefinition>;
  deletePrompt: (appId: AppId, id: string) => Promise<void>;
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  prompts: {
    'voice-rx': [],
    'kaira-bot': [],
  },
  isLoading: false,
  error: null,

  loadPrompts: async (appId, promptType) => {
    console.log('[PromptsStore] Loading prompts for', appId, 'type:', promptType);
    set({ isLoading: true, error: null });
    try {
      const prompts = await promptsRepository.getAll(appId, promptType);
      console.log('[PromptsStore] Loaded', prompts.length, 'prompts:', prompts);
      set((state) => ({
        prompts: {
          ...state.prompts,
          [appId]: prompts,
        },
        isLoading: false,
      }));
    } catch (err) {
      console.error('[PromptsStore] Failed to load prompts:', err);
      set({ error: err instanceof Error ? err.message : 'Failed to load prompts', isLoading: false });
    }
  },

  getPrompt: (appId, id) => {
    return (get().prompts[appId] || []).find(p => p.id === id);
  },

  getPromptsByType: (appId, promptType) => {
    return (get().prompts[appId] || []).filter(p => p.promptType === promptType);
  },

  savePrompt: async (appId, promptData) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await promptsRepository.save(appId, promptData as PromptDefinition);
      set(state => ({
        prompts: {
          ...state.prompts,
          [appId]: [saved, ...(state.prompts[appId] || []).filter(p => p.id !== saved.id)],
        },
        isLoading: false,
      }));
      return saved;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save prompt', isLoading: false });
      throw err;
    }
  },

  deletePrompt: async (appId, id) => {
    set({ isLoading: true, error: null });
    try {
      await promptsRepository.delete(appId, id);
      set(state => ({
        prompts: {
          ...state.prompts,
          [appId]: (state.prompts[appId] || []).filter(p => p.id !== id),
        },
        isLoading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete prompt', isLoading: false });
      throw err;
    }
  },
}));
