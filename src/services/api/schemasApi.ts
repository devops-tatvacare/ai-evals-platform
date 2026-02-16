/**
 * Schemas API - HTTP client for schemas API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 *
 * Note: Backend field is `schemaData` but frontend type uses `schema`.
 * We map schemaData -> schema on reads and schema -> schemaData on writes.
 */
import type { SchemaDefinition, AppId } from '@/types';
import { apiRequest } from './client';

/** Shape returned by backend (camelCase, dates as strings) */
interface ApiSchema {
  id: number;
  appId: string;
  promptType: string;
  version: number;
  name: string;
  schemaData: Record<string, unknown>;
  description?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

function toSchemaDefinition(s: ApiSchema): SchemaDefinition {
  return {
    id: String(s.id),
    name: s.name,
    version: s.version,
    promptType: s.promptType as SchemaDefinition['promptType'],
    schema: s.schemaData,
    description: s.description,
    isDefault: s.isDefault,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

export const schemasRepository = {
  async getAll(appId: AppId, promptType?: SchemaDefinition['promptType']): Promise<SchemaDefinition[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (promptType) {
      params.append('prompt_type', promptType);
    }
    const data = await apiRequest<ApiSchema[]>(`/api/schemas?${params}`);
    return data.map(toSchemaDefinition);
  },

  async getById(_appId: AppId, id: string): Promise<SchemaDefinition | null> {
    try {
      const data = await apiRequest<ApiSchema>(`/api/schemas/${id}`);
      return toSchemaDefinition(data);
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
    const data = await apiRequest<ApiSchema>('/api/schemas', {
      method: 'POST',
      body: JSON.stringify({
        appId: appId,
        promptType: schema.promptType,
        schemaData: schema.schema,
        description: schema.description,
        isDefault: schema.isDefault,
        name: schema.name,
      }),
    });
    return toSchemaDefinition(data);
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
      body: JSON.stringify({ appId: appId }),
    });
  },
};
