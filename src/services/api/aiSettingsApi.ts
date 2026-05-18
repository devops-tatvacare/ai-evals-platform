/**
 * Typed client for the admin AI settings bridge GET.
 *
 * Per-credential CRUD lives in `llmCredentialsApi.ts` (Phase 3); this file
 * only carries the legacy provider-summary list still consumed by 8 pages
 * for `credentialsOk` gating ("does this tenant have any working credential
 * for provider X?"). Plaintext secrets never reach the browser — the
 * response carries `hasApiKey: boolean` + a partial-reveal preview only.
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

const BASE = '/api/admin/ai-settings/providers';

export const aiSettingsApi = {
  list: (): Promise<ProviderConfig[]> => apiRequest<ProviderConfig[]>(BASE),
};
