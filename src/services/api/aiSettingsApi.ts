/**
 * Typed client for the admin AI settings endpoints.
 *
 * The encrypted API key never reaches the browser — GET responses carry
 * `hasApiKey: boolean` only. Upserts treat a blank `apiKey` as
 * "preserve the stored secret".
 */
import { apiRequest } from '@/services/api/client';

export type LLMProvider = 'openai' | 'azure_openai' | 'anthropic' | 'gemini';

export type ValidationStatus = 'ok' | 'invalid' | 'untested';

export interface ProviderConfig {
  provider: LLMProvider;
  isEnabled: boolean;
  hasApiKey: boolean;
  /** Partial-reveal preview of the stored key (`XYZA••••WXYZ` or `••••WXYZ`).
   *  `null` when no key is stored. Plaintext never crosses the wire. */
  apiKeyPreview: string | null;
  baseUrl: string | null;
  extraConfig: Record<string, unknown>;
  curatedModels: string[];
  validationStatus: ValidationStatus;
  lastValidatedAt: string | null;
}

export interface ProviderConfigUpsert {
  isEnabled: boolean;
  /** Blank string => preserve the stored secret. */
  apiKey: string;
  baseUrl: string | null;
  extraConfig: Record<string, unknown>;
  curatedModels: string[];
}

export interface DiscoverModelsResponse {
  models: string[];
}

export interface ValidateProviderResponse {
  validationStatus: ValidationStatus;
  detail: string | null;
}

const BASE = '/api/admin/ai-settings/providers';

export const aiSettingsApi = {
  list: (): Promise<ProviderConfig[]> => apiRequest<ProviderConfig[]>(BASE),

  upsert: (provider: LLMProvider, body: ProviderConfigUpsert): Promise<ProviderConfig> =>
    apiRequest<ProviderConfig>(`${BASE}/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  discoverModels: (provider: LLMProvider, search: string): Promise<DiscoverModelsResponse> =>
    apiRequest<DiscoverModelsResponse>(`${BASE}/${provider}/discover-models`, {
      method: 'POST',
      body: JSON.stringify({ search }),
    }),

  validate: (provider: LLMProvider): Promise<ValidateProviderResponse> =>
    apiRequest<ValidateProviderResponse>(`${BASE}/${provider}/validate`, {
      method: 'POST',
    }),
};
