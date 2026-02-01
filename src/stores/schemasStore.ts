import { create } from 'zustand';
import type { SchemaDefinition } from '@/types';
import { schemasRepository } from '@/services/storage';

interface SchemasState {
  schemas: SchemaDefinition[];
  isLoading: boolean;
  error: string | null;

  loadSchemas: (promptType?: SchemaDefinition['promptType']) => Promise<void>;
  getSchema: (id: string) => SchemaDefinition | undefined;
  getSchemasByType: (promptType: SchemaDefinition['promptType']) => SchemaDefinition[];
  saveSchema: (schema: Partial<SchemaDefinition> & { promptType: SchemaDefinition['promptType']; schema: Record<string, unknown> }) => Promise<SchemaDefinition>;
  deleteSchema: (id: string) => Promise<void>;
}

export const useSchemasStore = create<SchemasState>((set, get) => ({
  schemas: [],
  isLoading: false,
  error: null,

  loadSchemas: async (promptType) => {
    set({ isLoading: true, error: null });
    try {
      const schemas = await schemasRepository.getAll(promptType);
      set({ schemas, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load schemas', isLoading: false });
    }
  },

  getSchema: (id) => {
    return get().schemas.find(s => s.id === id);
  },

  getSchemasByType: (promptType) => {
    return get().schemas.filter(s => s.promptType === promptType);
  },

  saveSchema: async (schemaData) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await schemasRepository.save(schemaData as SchemaDefinition);
      set(state => ({
        schemas: [saved, ...state.schemas.filter(s => s.id !== saved.id)],
        isLoading: false,
      }));
      return saved;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save schema', isLoading: false });
      throw err;
    }
  },

  deleteSchema: async (id) => {
    set({ isLoading: true, error: null });
    try {
      await schemasRepository.delete(id);
      set(state => ({
        schemas: state.schemas.filter(s => s.id !== id),
        isLoading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete schema', isLoading: false });
      throw err;
    }
  },
}));
