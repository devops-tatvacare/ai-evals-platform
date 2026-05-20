import { apiRequest } from '@/services/api/client';

export type CapabilityTag =
  | 'text_input'
  | 'text_output'
  | 'image_input'
  | 'audio_input'
  | 'audio_output'
  | 'video_input'
  | 'pdf_input'
  | 'reasoning'
  | 'tool_call'
  | 'structured_output'
  | 'attachment';

export interface LlmModelOption {
  modelOrDeployment: string;
  displayName: string | null;
  provider: string;
  capabilities: CapabilityTag[];
  isDefaultForCallSite: boolean;
}

export interface CatalogModel {
  id: string;
  provider: string;
  model: string;
  displayName: string | null;
  family: string | null;
  capabilities: CapabilityTag[];
}

export const llmModelsApi = {
  list: (params: {
    callSite: string;
    credentialId: string;
  }): Promise<LlmModelOption[]> =>
    apiRequest<LlmModelOption[]>(
      `/api/llm/models?call_site=${encodeURIComponent(params.callSite)}&credential_id=${encodeURIComponent(params.credentialId)}`,
    ),

  catalog: (params: {
    provider?: string;
    includeDeprecated?: boolean;
  } = {}): Promise<CatalogModel[]> => {
    const qs = new URLSearchParams();
    if (params.provider) qs.set('provider', params.provider);
    if (params.includeDeprecated !== undefined) {
      qs.set('include_deprecated', params.includeDeprecated ? 'true' : 'false');
    }
    const tail = qs.toString();
    return apiRequest<CatalogModel[]>(
      `/api/llm/catalog${tail ? `?${tail}` : ''}`,
    );
  },
};
