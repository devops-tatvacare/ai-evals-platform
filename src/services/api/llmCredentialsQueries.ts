import { useMemo } from 'react';
import { useQueries, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiQueryFn } from '@/services/api/queryFn';
import {
  llmCredentialsApi,
  type CredentialCreateBody,
  type CredentialUpdateBody,
  type CuratedModel,
  type DeploymentCreateBody,
  type DeploymentUpdateBody,
  type LlmProvider,
  type TenantCredential,
  type TenantDeployment,
} from '@/services/api/llmCredentialsApi';

const SUPPORTED_PROVIDERS: LlmProvider[] = [
  'openai',
  'azure_openai',
  'anthropic',
  'gemini',
  'vertex',
  'bedrock',
];

const CRED_KEY = (provider: LlmProvider) =>
  ['admin', 'llm', 'credentials', provider] as const;

const DEPLOY_KEY = (credentialId: string) =>
  ['admin', 'llm', 'deployments', credentialId] as const;

const CURATED_KEY = (credentialId: string) =>
  ['admin', 'llm', 'curated-models', credentialId] as const;

/**
 * Aggregate every credential for the current tenant across every supported
 * provider. Fires one query per provider; TanStack de-dupes when other
 * mounted hooks also subscribe to a per-provider key.
 */
export function useAllTenantCredentials() {
  const queries = useQueries({
    queries: SUPPORTED_PROVIDERS.map((provider) => ({
      queryKey: CRED_KEY(provider),
      queryFn: () =>
        apiQueryFn<TenantCredential[]>(
          `/api/admin/ai-settings/providers/${provider}/credentials`,
        ),
      staleTime: 30_000,
    })),
  });
  const credentials = useMemo<TenantCredential[]>(
    () =>
      queries.flatMap((q) =>
        Array.isArray(q.data) ? (q.data as TenantCredential[]) : [],
      ),
    [queries],
  );
  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  return { credentials, isLoading, isError };
}

export function useTenantCredentials(provider: LlmProvider) {
  return useQuery<TenantCredential[]>({
    queryKey: CRED_KEY(provider),
    queryFn: () =>
      apiQueryFn<TenantCredential[]>(
        `/api/admin/ai-settings/providers/${provider}/credentials`,
      ),
    staleTime: 30_000,
  });
}

export function useCreateCredential(provider: LlmProvider) {
  const qc = useQueryClient();
  return useMutation<TenantCredential, Error, CredentialCreateBody>({
    mutationFn: (body) => llmCredentialsApi.create(provider, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CRED_KEY(provider) });
      qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
    },
  });
}

export function useUpdateCredential(provider: LlmProvider) {
  const qc = useQueryClient();
  return useMutation<
    TenantCredential,
    Error,
    { credentialId: string; body: CredentialUpdateBody }
  >({
    mutationFn: ({ credentialId, body }) =>
      llmCredentialsApi.patch(provider, credentialId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CRED_KEY(provider) });
      qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
    },
  });
}

export function useDeleteCredential(provider: LlmProvider) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (credentialId) => llmCredentialsApi.delete(provider, credentialId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CRED_KEY(provider) });
      qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
    },
  });
}

export function useValidateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) =>
      llmCredentialsApi.validate(credentialId),
    onSuccess: () => {
      // Bridge providers summary reads `validationStatus`/`lastValidatedAt`
      // off the same row; rail dot stays in sync without a refetch.
      qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
      // Per-provider credential lists also surface the new status.
      qc.invalidateQueries({ queryKey: ['admin', 'llm', 'credentials'] });
    },
  });
}

export function useTenantDeployments(credentialId: string | null) {
  return useQuery<TenantDeployment[]>({
    queryKey: DEPLOY_KEY(credentialId ?? ''),
    queryFn: () =>
      apiQueryFn<TenantDeployment[]>(
        `/api/admin/ai-settings/credentials/${credentialId}/deployments`,
      ),
    enabled: !!credentialId,
    staleTime: 30_000,
  });
}

function invalidateDeploymentEcho(qc: ReturnType<typeof useQueryClient>, credentialId: string) {
  // Bridge providers summary mirrors `curatedModels` from deployments
  // (`_sync_azure_deployments_for_bridge`), so the rail "N models" count
  // and the Azure card both refresh.
  qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
  qc.invalidateQueries({ queryKey: DEPLOY_KEY(credentialId) });
  // `/api/llm/models` is keyed `(call_site, credential_id)` and gates on
  // `enabled` + `canonical_model_id` — both flippable on these mutations,
  // so wipe the whole models cache (prefix match).
  qc.invalidateQueries({ queryKey: ['llm', 'models'] });
}

export function useCreateDeployment(credentialId: string) {
  const qc = useQueryClient();
  return useMutation<TenantDeployment, Error, DeploymentCreateBody>({
    mutationFn: (body) => llmCredentialsApi.createDeployment(credentialId, body),
    onSuccess: () => invalidateDeploymentEcho(qc, credentialId),
  });
}

export function useUpdateDeployment(credentialId: string) {
  const qc = useQueryClient();
  return useMutation<
    TenantDeployment,
    Error,
    { deploymentId: string; body: DeploymentUpdateBody }
  >({
    mutationFn: ({ deploymentId, body }) =>
      llmCredentialsApi.patchDeployment(deploymentId, body),
    onSuccess: () => invalidateDeploymentEcho(qc, credentialId),
  });
}

export function useDeleteDeployment(credentialId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (deploymentId) => llmCredentialsApi.deleteDeployment(deploymentId),
    onSuccess: () => invalidateDeploymentEcho(qc, credentialId),
  });
}

export function useCuratedModels(credentialId: string | null) {
  return useQuery<CuratedModel[]>({
    queryKey: CURATED_KEY(credentialId ?? ''),
    queryFn: () =>
      apiQueryFn<CuratedModel[]>(
        `/api/admin/ai-settings/credentials/${credentialId}/curated-models`,
      ),
    enabled: !!credentialId,
    staleTime: 30_000,
  });
}

function invalidateCuratedEcho(
  qc: ReturnType<typeof useQueryClient>,
  credentialId: string,
) {
  qc.invalidateQueries({ queryKey: CURATED_KEY(credentialId) });
  // `/api/llm/models` gates on the curated set per credential — wipe the
  // whole models cache (prefix match) so runtime dropdowns refresh.
  qc.invalidateQueries({ queryKey: ['llm', 'models'] });
  // The providers bridge summary gates UI on whether a credential is usable;
  // adding the first curated model can flip that, so refresh it too.
  qc.invalidateQueries({ queryKey: ['admin', 'ai-settings', 'providers'] });
}

export function useAddCuratedModel(credentialId: string) {
  const qc = useQueryClient();
  return useMutation<CuratedModel, Error, string>({
    mutationFn: (canonicalModelId) =>
      llmCredentialsApi.addCuratedModel(credentialId, canonicalModelId),
    onSuccess: () => invalidateCuratedEcho(qc, credentialId),
  });
}

export function useRemoveCuratedModel(credentialId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (curatedModelId) =>
      llmCredentialsApi.removeCuratedModel(curatedModelId),
    onSuccess: () => invalidateCuratedEcho(qc, credentialId),
  });
}
