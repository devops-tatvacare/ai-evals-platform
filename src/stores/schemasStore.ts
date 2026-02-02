import { create } from 'zustand';
import type { SchemaDefinition, AppId } from '@/types';
import { schemasRepository } from '@/services/storage';

interface SchemasState {
  // Schemas keyed by appId
  schemas: Record<AppId, SchemaDefinition[]>;
  isLoading: boolean;
  error: string | null;

  loadSchemas: (appId: AppId, promptType?: SchemaDefinition['promptType']) => Promise<void>;
  getSchema: (appId: AppId, id: string) => SchemaDefinition | undefined;
  getSchemasByType: (appId: AppId, promptType: SchemaDefinition['promptType']) => SchemaDefinition[];
  saveSchema: (appId: AppId, schema: Partial<SchemaDefinition> & { promptType: SchemaDefinition['promptType']; schema: Record<string, unknown> }) => Promise<SchemaDefinition>;
  deleteSchema: (appId: AppId, id: string) => Promise<void>;
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  schemas: {
    'voice-rx': [],
    'kaira-bot': [],
  },
  isLoading: false,
  error: null,

  loadSchemas: async (appId, promptType) => {
    set({ isLoading: true, error: null });
    try {
      const schemas = await schemasRepository.getAll(appId, promptType);
      set((state) => ({ 
        schemas: {
          ...state.schemas,
          [appId]: schemas,
        },
        isLoading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load schemas', isLoading: false });
    }
  },

  getSchema: (appId, id) => {
    return (get().schemas[appId] || []).find(s => s.id === id);
  },

  getSchemasByType: (appId, promptType) => {
    return (get().schemas[appId] || []).filter(s => s.promptType === promptType);
  },

  saveSchema: async (appId, schemaData) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await schemasRepository.save(appId, schemaData as SchemaDefinition);
      set(state => ({
        schemas: {
          ...state.schemas,
          [appId]: [saved, ...(state.schemas[appId] || []).filter(s => s.id !== saved.id)],
        },
        isLoading: false,
      }));
      return saved;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save schema', isLoading: false });
      throw err;
    }
  },

  deleteSchema: async (appId, id) => {
    set({ isLoading: true, error: null });
    try {
      await schemasRepository.delete(appId, id);
      set(state => ({
        schemas: {
          ...state.schemas,
          [appId]: (state.schemas[appId] || []).filter(s => s.id !== id),
        },
        isLoading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete schema', isLoading: false });
      throw err;
    }
  },
}));
