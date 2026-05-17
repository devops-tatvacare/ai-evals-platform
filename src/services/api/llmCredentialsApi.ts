import { apiRequest } from '@/services/api/client';

export type LlmProvider =
  | 'openai'
  | 'azure_openai'
  | 'anthropic'
  | 'gemini'
  | 'vertex'
  | 'bedrock';

export type ValidationStatus = 'ok' | 'invalid' | 'untested';

export interface TenantCredential {
  id: string;
  provider: LlmProvider;
  name: string;
  isEnabled: boolean;
  secretPreview: string | null;
  extraConfig: Record<string, unknown>;
  validationStatus: ValidationStatus;
  lastValidatedAt: string | null;
}

export interface CredentialCreateBody {
  name?: string;
  isEnabled?: boolean;
  secret: Record<string, string>;
  extraConfig?: Record<string, unknown>;
}

export interface CredentialUpdateBody {
  name?: string;
  isEnabled?: boolean;
  secret?: Record<string, string | null>;
  extraConfig?: Record<string, unknown>;
}

export interface ValidateResult {
  validationStatus: ValidationStatus;
  detail: string | null;
}

export interface ModelSearchResponse {
  models: string[];
}

export interface TenantDeployment {
  id: string;
  credentialId: string;
  deploymentName: string;
  canonicalModelId: string | null;
  canonicalModel: string | null;
  apiVersionOverride: string | null;
  enabled: boolean;
  needsMapping: boolean;
}

export interface DeploymentCreateBody {
  deploymentName: string;
  canonicalModelId?: string | null;
  apiVersionOverride?: string | null;
  enabled?: boolean;
}

export interface DeploymentUpdateBody {
  canonicalModelId?: string | null;
  apiVersionOverride?: string | null;
  enabled?: boolean;
}

const BASE = '/api/admin/ai-settings';

export const llmCredentialsApi = {
  // multi-credential per provider
  listForProvider: (provider: LlmProvider): Promise<TenantCredential[]> =>
    apiRequest<TenantCredential[]>(`${BASE}/providers/${provider}/credentials`),

  create: (
    provider: LlmProvider,
    body: CredentialCreateBody,
  ): Promise<TenantCredential> =>
    apiRequest<TenantCredential>(`${BASE}/providers/${provider}/credentials`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  patch: (
    provider: LlmProvider,
    credentialId: string,
    body: CredentialUpdateBody,
  ): Promise<TenantCredential> =>
    apiRequest<TenantCredential>(
      `${BASE}/providers/${provider}/credentials/${credentialId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),

  delete: (provider: LlmProvider, credentialId: string): Promise<void> =>
    apiRequest<void>(
      `${BASE}/providers/${provider}/credentials/${credentialId}`,
      { method: 'DELETE' },
    ),

  validate: (credentialId: string): Promise<ValidateResult> =>
    apiRequest<ValidateResult>(`${BASE}/credentials/${credentialId}/validate`, {
      method: 'POST',
    }),

  discoverModels: (
    credentialId: string,
    search: string,
  ): Promise<ModelSearchResponse> =>
    apiRequest<ModelSearchResponse>(
      `${BASE}/credentials/${credentialId}/discover-models`,
      { method: 'POST', body: JSON.stringify({ search }) },
    ),

  // Azure deployments
  listDeployments: (credentialId: string): Promise<TenantDeployment[]> =>
    apiRequest<TenantDeployment[]>(
      `${BASE}/credentials/${credentialId}/deployments`,
    ),

  createDeployment: (
    credentialId: string,
    body: DeploymentCreateBody,
  ): Promise<TenantDeployment> =>
    apiRequest<TenantDeployment>(
      `${BASE}/credentials/${credentialId}/deployments`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  patchDeployment: (
    deploymentId: string,
    body: DeploymentUpdateBody,
  ): Promise<TenantDeployment> =>
    apiRequest<TenantDeployment>(`${BASE}/deployments/${deploymentId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteDeployment: (deploymentId: string): Promise<void> =>
    apiRequest<void>(`${BASE}/deployments/${deploymentId}`, {
      method: 'DELETE',
    }),
};
