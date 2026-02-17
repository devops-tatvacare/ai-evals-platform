/**
 * Prompts API - HTTP client for prompts API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import type { PromptDefinition, AppId } from '@/types';
import { apiRequest } from './client';

/** Shape returned by backend (camelCase, dates as strings) */
interface ApiPrompt {
  id: number;
  appId: string;
  promptType: string;
  version: number;
  name: string;
  prompt: string;
  description?: string;
  isDefault?: boolean;
  sourceType?: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPromptDefinition(p: ApiPrompt): PromptDefinition {
  return {
    id: String(p.id),
    name: p.name,
    version: p.version,
    promptType: p.promptType as PromptDefinition['promptType'],
    prompt: p.prompt,
    description: p.description,
    isDefault: p.isDefault,
    sourceType: (p.sourceType as PromptDefinition['sourceType']) ?? null,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  };
}

export const promptsRepository = {
  async getAll(appId: AppId, promptType?: PromptDefinition['promptType']): Promise<PromptDefinition[]> {
    const params = new URLSearchParams({ app_id: appId });
    if (promptType) {
      params.append('prompt_type', promptType);
    }
    const data = await apiRequest<ApiPrompt[]>(`/api/prompts?${params}`);
    return data.map(toPromptDefinition);
  },

  async getById(_appId: AppId, id: string): Promise<PromptDefinition | null> {
    try {
      const data = await apiRequest<ApiPrompt>(`/api/prompts/${id}`);
      return toPromptDefinition(data);
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
    const data = await apiRequest<ApiPrompt>('/api/prompts', {
      method: 'POST',
      body: JSON.stringify({
        appId: appId,
        promptType: prompt.promptType,
        prompt: prompt.prompt,
        description: prompt.description,
        isDefault: prompt.isDefault,
        sourceType: prompt.sourceType,
        name: prompt.name,
      }),
    });
    return toPromptDefinition(data);
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
      body: JSON.stringify({ appId: appId }),
    });
  },
};
