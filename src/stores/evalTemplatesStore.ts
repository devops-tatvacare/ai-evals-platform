import { create } from 'zustand';
import {
  createAppRecord,
  type AppId,
  type EvalTemplate,
  type TemplateType,
  type CreateTemplatePayload,
  type NewVersionPayload,
} from '@/types';
import type { AssetVisibility } from '@/types/settings.types';
import { evalTemplatesRepository } from '@/services/api/evalTemplatesApi';

interface EvalTemplatesState {
  /** Templates keyed by appId */
  templates: Record<AppId, EvalTemplate[]>;
  /** Whether templates have been loaded for a given appId */
  isLoaded: Record<AppId, boolean>;
  isLoading: boolean;
  error: string | null;

  loadTemplates: (appId: AppId, opts?: { templateType?: TemplateType; sourceType?: string; latestOnly?: boolean }) => Promise<void>;
  getTemplate: (appId: AppId, id: string) => EvalTemplate | undefined;
  getTemplatesByType: (appId: AppId, templateType: TemplateType, sourceType?: string) => EvalTemplate[];
  getBranchVersions: (appId: AppId, branchKey: string) => Promise<EvalTemplate[]>;
  createTemplate: (appId: AppId, payload: CreateTemplatePayload) => Promise<EvalTemplate>;
  createNewVersion: (appId: AppId, templateId: string, payload: NewVersionPayload) => Promise<EvalTemplate>;
  forkTemplate: (appId: AppId, templateId: string) => Promise<EvalTemplate>;
  updateMetadata: (appId: AppId, templateId: string, updates: Partial<Pick<EvalTemplate, 'name' | 'description'>>) => Promise<EvalTemplate>;
  setVisibility: (appId: AppId, templateId: string, visibility: AssetVisibility) => Promise<EvalTemplate>;
  deleteTemplate: (appId: AppId, templateId: string) => Promise<void>;
  reset: () => void;
}

function removeById(items: EvalTemplate[], id: string): EvalTemplate[] {
  return items.filter((item) => item.id !== id);
}

function replaceOrPrepend(items: EvalTemplate[], template: EvalTemplate): EvalTemplate[] {
  const idx = items.findIndex((t) => t.id === template.id);
  if (idx !== -1) {
    return items.map((t) => (t.id === template.id ? template : t));
  }
  return [template, ...items];
}

const createTemplatesByApp = () => createAppRecord<EvalTemplate[]>(() => []);
const createTemplateLoadedState = () => createAppRecord(() => false);

export const useEvalTemplatesStore = create<EvalTemplatesState>((set, get) => ({
  templates: createTemplatesByApp(),
  isLoaded: createTemplateLoadedState(),
  isLoading: false,
  error: null,

  loadTemplates: async (appId, opts = {}) => {
    set({ isLoading: true, error: null });
    try {
      const templates = await evalTemplatesRepository.getAll(appId, {
        templateType: opts.templateType,
        sourceType: opts.sourceType,
        latestOnly: opts.latestOnly,
      });
      set((state) => ({
        templates: { ...state.templates, [appId]: templates },
        isLoaded: { ...state.isLoaded, [appId]: true },
        isLoading: false,
      }));
    } catch (err) {
      console.error('[EvalTemplatesStore] Failed to load templates:', err);
      set({
        error: err instanceof Error ? err.message : 'Failed to load templates',
        isLoading: false,
      });
    }
  },

  getTemplate: (appId, id) => {
    return get().templates[appId].find((t) => t.id === id);
  },

  getTemplatesByType: (appId, templateType, sourceType) => {
    return get().templates[appId].filter((t) => {
      if (t.templateType !== templateType) return false;
      if (sourceType) {
        return t.sourceType === sourceType || !t.sourceType;
      }
      return true;
    });
  },

  getBranchVersions: async (appId, branchKey) => {
    return evalTemplatesRepository.getBranchVersions(appId, branchKey);
  },

  createTemplate: async (appId, payload) => {
    set({ isLoading: true, error: null });
    try {
      const created = await evalTemplatesRepository.create(appId, payload);
      set((state) => ({
        templates: {
          ...state.templates,
          [appId]: [created, ...state.templates[appId]],
        },
        isLoading: false,
      }));
      return created;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create template',
        isLoading: false,
      });
      throw err;
    }
  },

  createNewVersion: async (appId, templateId, payload) => {
    set({ isLoading: true, error: null });
    try {
      const newVersion = await evalTemplatesRepository.createNewVersion(templateId, payload);
      // Reload full list to ensure latest-only dedup is correct
      const templates = await evalTemplatesRepository.getAll(appId, { latestOnly: true });
      set((state) => ({
        templates: { ...state.templates, [appId]: templates },
        isLoaded: { ...state.isLoaded, [appId]: true },
        isLoading: false,
      }));
      return newVersion;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create new template version',
        isLoading: false,
      });
      throw err;
    }
  },

  forkTemplate: async (appId, templateId) => {
    set({ isLoading: true, error: null });
    try {
      const forked = await evalTemplatesRepository.fork(appId, templateId);
      set((state) => ({
        templates: {
          ...state.templates,
          [appId]: [forked, ...state.templates[appId]],
        },
        isLoading: false,
      }));
      return forked;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fork template',
        isLoading: false,
      });
      throw err;
    }
  },

  updateMetadata: async (appId, templateId, updates) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await evalTemplatesRepository.updateMetadata(templateId, updates);
      set((state) => ({
        templates: {
          ...state.templates,
          [appId]: replaceOrPrepend(state.templates[appId], updated),
        },
        isLoading: false,
      }));
      return updated;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update template metadata',
        isLoading: false,
      });
      throw err;
    }
  },

  setVisibility: async (appId, templateId, visibility) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await evalTemplatesRepository.setVisibility(templateId, visibility);
      set((state) => ({
        templates: {
          ...state.templates,
          [appId]: replaceOrPrepend(state.templates[appId], updated),
        },
        isLoading: false,
      }));
      return updated;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update template visibility',
        isLoading: false,
      });
      throw err;
    }
  },

  deleteTemplate: async (appId, templateId) => {
    set({ isLoading: true, error: null });
    try {
      await evalTemplatesRepository.delete(templateId);
      set((state) => ({
        templates: {
          ...state.templates,
          [appId]: removeById(state.templates[appId], templateId),
        },
        isLoading: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete template',
        isLoading: false,
      });
      throw err;
    }
  },

  reset: () =>
    set({
      templates: createTemplatesByApp(),
      isLoaded: createTemplateLoadedState(),
      isLoading: false,
      error: null,
    }),
}));
