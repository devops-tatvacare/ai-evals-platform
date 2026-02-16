/**
 * Prompts API - HTTP implementation replacing Dexie-based promptsRepository.
 *
 * IMPORTANT: This is a plain object (not a class like the old one).
 * It exports the same interface so stores can call it the same way.
 */
import type { PromptDefinition, AppId } from '@/types';
import { apiRequest } from './client';

export const promptsRepository = {
  async getAll(appId: AppId, promptType?: PromptDefinition['promptType']): Promise<PromptDefinition[]> {
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
      prompt: string;
      description?: string;
      is_default?: boolean;
      created_at: string;
      updated_at: string;
    }>>(`/api/prompts?${params}`);

    return data.map(p => ({
      id: String(p.id),
      name: p.name,
      version: p.version,
      promptType: p.prompt_type as PromptDefinition['promptType'],
      prompt: p.prompt,
      description: p.description,
      isDefault: p.is_default,
      createdAt: new Date(p.created_at),
      updatedAt: new Date(p.updated_at),
    }));
  },

  async getById(_appId: AppId, id: string): Promise<PromptDefinition | null> {
    try {
      const data = await apiRequest<{
        id: number;
        app_id: string;
        prompt_type: string;
        version: number;
        name: string;
        prompt: string;
        description?: string;
        is_default?: boolean;
        created_at: string;
        updated_at: string;
      }>(`/api/prompts/${id}`);

      return {
        id: String(data.id),
        name: data.name,
        version: data.version,
        promptType: data.prompt_type as PromptDefinition['promptType'],
        prompt: data.prompt,
        description: data.description,
        isDefault: data.is_default,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      return null;
    }
  },

  async getLatestVersion(appId: AppId, promptType: PromptDefinition['promptType']): Promise<number> {
    const prompts = await this.getAll(appId, promptType);
    if (prompts.length === 0) return 0;
    return Math.max(...prompts.map(p => p.version));
  },

  async save(appId: AppId, prompt: PromptDefinition): Promise<PromptDefinition> {
    const data = await apiRequest<{
      id: number;
      app_id: string;
      prompt_type: string;
      version: number;
      name: string;
      prompt: string;
      description?: string;
      is_default?: boolean;
      created_at: string;
      updated_at: string;
    }>('/api/prompts', {
      method: 'POST',
      body: JSON.stringify({
        app_id: appId,
        prompt_type: prompt.promptType,
        prompt: prompt.prompt,
        description: prompt.description,
        is_default: prompt.isDefault,
        name: prompt.name,
      }),
    });

    return {
      id: String(data.id),
      name: data.name,
      version: data.version,
      promptType: data.prompt_type as PromptDefinition['promptType'],
      prompt: data.prompt,
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
    await apiRequest(`/api/prompts/${id}`, {
      method: 'DELETE',
    });
  },

  async ensureDefaults(appId: AppId): Promise<void> {
    await apiRequest('/api/prompts/ensure-defaults', {
      method: 'POST',
      body: JSON.stringify({ app_id: appId }),
    });
  },
};
