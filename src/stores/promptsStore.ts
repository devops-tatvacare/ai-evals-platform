import { create } from 'zustand';
import type { PromptDefinition } from '@/types';
import { promptsRepository } from '@/services/storage';

interface PromptsState {
  prompts: PromptDefinition[];
  isLoading: boolean;
  error: string | null;

  loadPrompts: (promptType?: PromptDefinition['promptType']) => Promise<void>;
  getPrompt: (id: string) => PromptDefinition | undefined;
  getPromptsByType: (promptType: PromptDefinition['promptType']) => PromptDefinition[];
  savePrompt: (prompt: Partial<PromptDefinition> & { promptType: PromptDefinition['promptType']; prompt: string }) => Promise<PromptDefinition>;
  deletePrompt: (id: string) => Promise<void>;
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  prompts: [],
  isLoading: false,
  error: null,

  loadPrompts: async (promptType) => {
    set({ isLoading: true, error: null });
    try {
      const prompts = await promptsRepository.getAll(promptType);
      set({ prompts, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load prompts', isLoading: false });
    }
  },

  getPrompt: (id) => {
    return get().prompts.find(p => p.id === id);
  },

  getPromptsByType: (promptType) => {
    return get().prompts.filter(p => p.promptType === promptType);
  },

  savePrompt: async (promptData) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await promptsRepository.save(promptData as PromptDefinition);
      set(state => ({
        prompts: [saved, ...state.prompts.filter(p => p.id !== saved.id)],
        isLoading: false,
      }));
      return saved;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save prompt', isLoading: false });
      throw err;
    }
  },

  deletePrompt: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await promptsRepository.delete(id);
      set(state => ({
        prompts: state.prompts.filter(p => p.id !== id),
        isLoading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete prompt', isLoading: false });
      throw err;
    }
  },
}));
