/**
 * Evaluators API - HTTP implementation replacing Dexie-based evaluatorsRepository.
 */
import type { EvaluatorDefinition } from '@/types';
import { apiRequest } from './client';

export const evaluatorsRepository = {
  async save(evaluator: EvaluatorDefinition): Promise<void> {
    if (evaluator.id) {
      // Update existing
      await apiRequest(`/api/evaluators/${evaluator.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: evaluator.name,
          prompt: evaluator.prompt,
          model_id: evaluator.modelId,
          output_schema: evaluator.outputSchema,
          is_global: evaluator.isGlobal,
          show_in_header: evaluator.showInHeader,
        }),
      });
    } else {
      // Create new
      await apiRequest('/api/evaluators', {
        method: 'POST',
        body: JSON.stringify({
          name: evaluator.name,
          prompt: evaluator.prompt,
          model_id: evaluator.modelId,
          output_schema: evaluator.outputSchema,
          app_id: evaluator.appId,
          listing_id: evaluator.listingId,
          is_global: evaluator.isGlobal,
          show_in_header: evaluator.showInHeader,
        }),
      });
    }
  },

  async getById(id: string): Promise<EvaluatorDefinition | undefined> {
    try {
      const data = await apiRequest<{
        id: string;
        app_id: string;
        listing_id: string;
        name: string;
        prompt: string;
        model_id: string;
        output_schema: unknown;
        is_global: boolean;
        show_in_header?: boolean;
        forked_from?: string;
        created_at: string;
        updated_at: string;
      }>(`/api/evaluators/${id}`);

      return {
        id: data.id,
        appId: data.app_id,
        listingId: data.listing_id,
        name: data.name,
        prompt: data.prompt,
        modelId: data.model_id,
        outputSchema: data.output_schema as EvaluatorDefinition['outputSchema'],
        isGlobal: data.is_global,
        showInHeader: data.show_in_header,
        forkedFrom: data.forked_from,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      };
    } catch (err) {
      return undefined;
    }
  },

  async getByAppId(appId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<Array<{
      id: string;
      app_id: string;
      listing_id: string;
      name: string;
      prompt: string;
      model_id: string;
      output_schema: unknown;
      is_global: boolean;
      show_in_header?: boolean;
      forked_from?: string;
      created_at: string;
      updated_at: string;
    }>>(`/api/evaluators?app_id=${appId}`);

    return data.map(e => ({
      id: e.id,
      appId: e.app_id,
      listingId: e.listing_id,
      name: e.name,
      prompt: e.prompt,
      modelId: e.model_id,
      outputSchema: e.output_schema as EvaluatorDefinition['outputSchema'],
      isGlobal: e.is_global,
      showInHeader: e.show_in_header,
      forkedFrom: e.forked_from,
      createdAt: new Date(e.created_at),
      updatedAt: new Date(e.updated_at),
    }));
  },

  async getForListing(appId: string, listingId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<Array<{
      id: string;
      app_id: string;
      listing_id: string;
      name: string;
      prompt: string;
      model_id: string;
      output_schema: unknown;
      is_global: boolean;
      show_in_header?: boolean;
      forked_from?: string;
      created_at: string;
      updated_at: string;
    }>>(`/api/evaluators?app_id=${appId}&listing_id=${listingId}`);

    return data.map(e => ({
      id: e.id,
      appId: e.app_id,
      listingId: e.listing_id,
      name: e.name,
      prompt: e.prompt,
      modelId: e.model_id,
      outputSchema: e.output_schema as EvaluatorDefinition['outputSchema'],
      isGlobal: e.is_global,
      showInHeader: e.show_in_header,
      forkedFrom: e.forked_from,
      createdAt: new Date(e.created_at),
      updatedAt: new Date(e.updated_at),
    }));
  },

  async getRegistry(appId: string): Promise<EvaluatorDefinition[]> {
    const data = await apiRequest<Array<{
      id: string;
      app_id: string;
      listing_id: string;
      name: string;
      prompt: string;
      model_id: string;
      output_schema: unknown;
      is_global: boolean;
      show_in_header?: boolean;
      forked_from?: string;
      created_at: string;
      updated_at: string;
    }>>(`/api/evaluators/registry?app_id=${appId}`);

    return data.map(e => ({
      id: e.id,
      appId: e.app_id,
      listingId: e.listing_id,
      name: e.name,
      prompt: e.prompt,
      modelId: e.model_id,
      outputSchema: e.output_schema as EvaluatorDefinition['outputSchema'],
      isGlobal: e.is_global,
      showInHeader: e.show_in_header,
      forkedFrom: e.forked_from,
      createdAt: new Date(e.created_at),
      updatedAt: new Date(e.updated_at),
    }));
  },

  async fork(sourceId: string, targetListingId: string): Promise<EvaluatorDefinition> {
    const data = await apiRequest<{
      id: string;
      app_id: string;
      listing_id: string;
      name: string;
      prompt: string;
      model_id: string;
      output_schema: unknown;
      is_global: boolean;
      show_in_header?: boolean;
      forked_from?: string;
      created_at: string;
      updated_at: string;
    }>(`/api/evaluators/${sourceId}/fork?listing_id=${targetListingId}`, {
      method: 'POST',
    });

    return {
      id: data.id,
      appId: data.app_id,
      listingId: data.listing_id,
      name: data.name,
      prompt: data.prompt,
      modelId: data.model_id,
      outputSchema: data.output_schema as EvaluatorDefinition['outputSchema'],
      isGlobal: data.is_global,
      showInHeader: data.show_in_header,
      forkedFrom: data.forked_from,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  },

  async setGlobal(id: string, isGlobal: boolean): Promise<void> {
    await apiRequest(`/api/evaluators/${id}/global`, {
      method: 'PUT',
      body: JSON.stringify({ is_global: isGlobal }),
    });
  },

  async delete(id: string): Promise<void> {
    await apiRequest(`/api/evaluators/${id}`, {
      method: 'DELETE',
    });
  },
};
