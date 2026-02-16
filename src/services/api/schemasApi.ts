/**
 * Schemas API - HTTP client for schemas API.
 *
 * IMPORTANT: This is a plain object (not a class like the old one).
 * It exports the same interface so stores can call it the same way.
 */
import type { SchemaDefinition, AppId } from '@/types';
import { apiRequest } from './client';

export const schemasRepository = {
  async getAll(appId: AppId, promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (promptType) {
      params.append('prompt_type', promptType);
    }
    const data = await apiRequest<Array<{
      id: number;
      app_id: string;
      prompt_type: string;
      version: number;
      name: string;
      schema_data: Record<string, unknown>;
      description?: string;
      is_default?: boolean;
      created_at: string;
      updated_at: string;
    }>>(`/api/schemas?${params}`);

    return data.map(s => ({
      id: String(s.id),
      name: s.name,
      version: s.version,
      promptType: s.prompt_type as SchemaDefinition['promptType'],
      schema: s.schema_data,
      description: s.description,
      isDefault: s.is_default,
      createdAt: new Date(s.created_at),
      updatedAt: new Date(s.updated_at),
    }));
  },

  async getById(_appId: AppId, id: string): Promise<SchemaDefinition | null> {
    try {
      const data = await apiRequest<{
        id: number;
        app_id: string;
        prompt_type: string;
        version: number;
        name: string;
        schema_data: Record<string, unknown>;
        description?: string;
        is_default?: boolean;
        created_at: string;
        updated_at: string;
      }>(`/api/schemas/${id}`);

      return {
        id: String(data.id),
        name: data.name,
        version: data.version,
        promptType: data.prompt_type as SchemaDefinition['promptType'],
        schema: data.schema_data,
        description: data.description,
        isDefault: data.is_default,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      return null;
    }
  },

  async getLatestVersion(appId: AppId, promptType: SchemaDefinition['promptType']): Promise<number> {
    const schemas = await this.getAll(appId, promptType);
    if (schemas.length === 0) return 0;
    return Math.max(...schemas.map(s => s.version));
  },

  async save(appId: AppId, schema: SchemaDefinition): Promise<SchemaDefinition> {
    const data = await apiRequest<{
      id: number;
      app_id: string;
      prompt_type: string;
      version: number;
      name: string;
      schema_data: Record<string, unknown>;
      description?: string;
      is_default?: boolean;
      created_at: string;
      updated_at: string;
    }>('/api/schemas', {
      method: 'POST',
      body: JSON.stringify({
        app_id: appId,
        prompt_type: schema.promptType,
        schema_data: schema.schema,
        description: schema.description,
        is_default: schema.isDefault,
        name: schema.name,
      }),
    });

    return {
      id: String(data.id),
      name: data.name,
      version: data.version,
      promptType: data.prompt_type as SchemaDefinition['promptType'],
      schema: data.schema_data,
      description: data.description,
      isDefault: data.is_default,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  },

  async checkDependencies(_appId: AppId, _id: string): Promise<{ count: number; listings: string[] }> {
    // TODO: implement server-side dependency check when needed
    return { count: 0, listings: [] };
  },

  async delete(_appId: AppId, id: string): Promise<void> {
    await apiRequest(`/api/schemas/${id}`, {
      method: 'DELETE',
    });
  },

  async ensureDefaults(appId: AppId): Promise<void> {
    await apiRequest('/api/schemas/ensure-defaults', {
      method: 'POST',
      body: JSON.stringify({ app_id: appId }),
    });
  },
};
