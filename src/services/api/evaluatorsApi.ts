/**
 * Evaluators API - HTTP client for evaluators API.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 * Query params remain snake_case (FastAPI query params).
 */
import type { EvaluatorDefinition } from '@/types';
import { apiRequest } from './client';

/** Shape returned by backend (camelCase, dates as strings) */
interface ApiEvaluator {
  id: string;
  appId: string;
  listingId: string | null;
  name: string;
  prompt: string;
  modelId: string;
  outputSchema: unknown;
  isGlobal: boolean;
  showInHeader?: boolean;
  forkedFrom?: string;
  createdAt: string;
  updatedAt: string;
}

function toEvaluatorDefinition(e: ApiEvaluator): EvaluatorDefinition {
  return {
    id: e.id,
    appId: e.appId,
    listingId: e.listingId ?? undefined,
    name: e.name,
    prompt: e.prompt,
    modelId: e.modelId,
    outputSchema: e.outputSchema as EvaluatorDefinition['outputSchema'],
    isGlobal: e.isGlobal,
    showInHeader: e.showInHeader,
    forkedFrom: e.forkedFrom,
    createdAt: new Date(e.createdAt),
    updatedAt: new Date(e.updatedAt),
  };
}

export const evaluatorsRepository = {
  async save(evaluator: EvaluatorDefinition): Promise<EvaluatorDefinition> {
    if (evaluator.id) {
      // Update existing
      const data = await apiRequest<ApiEvaluator>(`/api/evaluators/${evaluator.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: evaluator.name,
          prompt: evaluator.prompt,
          modelId: evaluator.modelId,
          outputSchema: evaluator.outputSchema,
          isGlobal: evaluator.isGlobal,
          showInHeader: evaluator.showInHeader,
        }),
      });
      return toEvaluatorDefinition(data);
    } else {
      // Create new
      const data = await apiRequest<ApiEvaluator>('/api/evaluators', {
        method: 'POST',
        body: JSON.stringify({
          name: evaluator.name,
          prompt: evaluator.prompt,
          modelId: evaluator.modelId,
          outputSchema: evaluator.outputSchema,
          appId: evaluator.appId,
          listingId: evaluator.listingId,
          isGlobal: evaluator.isGlobal,
          showInHeader: evaluator.showInHeader,
        }),
      });
      return toEvaluatorDefinition(data);
    }
  },

  async getById(id: string): Promise<EvaluatorDefinition | undefined> {
    try {
      const data = await apiRequest<ApiEvaluator>(`/api/evaluators/${id}`);
      return toEvaluatorDefinition(data);
    } catch (err) {
      return undefined;
    }
  },

  async getByAppId(appId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<ApiEvaluator[]>(`/api/evaluators?app_id=${appId}`);
    return data.map(toEvaluatorDefinition);
  },

  async getForListing(appId: string, listingId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<ApiEvaluator[]>(`/api/evaluators?app_id=${appId}&listing_id=${listingId}`);
    return data.map(toEvaluatorDefinition);
  },

  async getRegistry(appId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<ApiEvaluator[]>(`/api/evaluators/registry?app_id=${appId}`);
    return data.map(toEvaluatorDefinition);
  },

  async fork(sourceId: string, targetListingId: string): Promise<EvaluatorDefinition> {
    const params = targetListingId ? `?listing_id=${targetListingId}` : '';
    const data = await apiRequest<ApiEvaluator>(
      `/api/evaluators/${sourceId}/fork${params}`,
      { method: 'POST' }
    );
    return toEvaluatorDefinition(data);
  },

  async setGlobal(id: string, isGlobal: boolean): Promise<void> {
    await apiRequest(`/api/evaluators/${id}/global`, {
      method: 'PUT',
      body: JSON.stringify({ isGlobal }),
    });
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/evaluators/${id}`, {
      method: 'DELETE',
    });
  },
};
