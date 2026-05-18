/**
 * Saved cohort TanStack Query hooks. Server data via apiQueryFn so the
 * shared 401-refresh-and-retry flow stays in effect.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCohort,
  createDraftVersion,
  deleteCohort,
  editDraftVersion,
  getCohort,
  listCohorts,
  listUsedBy,
  publishVersion,
  updateCohort,
  type CohortDetailResponse,
  type CohortResponse,
  type CohortVersionPayload,
  type CreateCohortBody,
  type UpdateCohortBody,
  type WorkflowBindingResponse,
} from '@/services/api/orchestrationCohorts';

export const cohortQueryKeys = {
  list: (appId: string) => ['orchestration', 'cohorts', 'list', appId] as const,
  detail: (cohortId: string) =>
    ['orchestration', 'cohorts', 'detail', cohortId] as const,
  usedBy: (cohortId: string) =>
    ['orchestration', 'cohorts', 'used-by', cohortId] as const,
};

export function useCohorts(appId: string | null | undefined) {
  return useQuery<CohortResponse[]>({
    queryKey: cohortQueryKeys.list(appId ?? ''),
    queryFn: () => listCohorts({ appId: appId as string }),
    enabled: Boolean(appId),
  });
}

export function useCohort(cohortId: string | null | undefined) {
  return useQuery<CohortDetailResponse>({
    queryKey: cohortQueryKeys.detail(cohortId ?? ''),
    queryFn: () => getCohort(cohortId as string),
    enabled: Boolean(cohortId),
  });
}

export function useCohortUsedBy(cohortId: string | null | undefined) {
  return useQuery<WorkflowBindingResponse[]>({
    queryKey: cohortQueryKeys.usedBy(cohortId ?? ''),
    queryFn: () => listUsedBy(cohortId as string),
    enabled: Boolean(cohortId),
  });
}

export function useCreateCohort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCohortBody) => createCohort(body),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: cohortQueryKeys.list(created.appId) });
    },
  });
}

export function useUpdateCohort(cohortId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCohortBody) => updateCohort(cohortId, body),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: cohortQueryKeys.list(updated.appId) });
      qc.setQueryData(cohortQueryKeys.detail(cohortId), updated);
    },
  });
}

export function useDeleteCohort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cohortId: string) => deleteCohort(cohortId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orchestration', 'cohorts'] });
    },
  });
}

export function useCreateDraftVersion(cohortId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CohortVersionPayload) =>
      createDraftVersion(cohortId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cohortQueryKeys.detail(cohortId) });
    },
  });
}

export function useEditDraftVersion(cohortId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      versionId,
      payload,
    }: {
      versionId: string;
      payload: CohortVersionPayload;
    }) => editDraftVersion(cohortId, versionId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cohortQueryKeys.detail(cohortId) });
    },
  });
}

export function usePublishVersion(cohortId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => publishVersion(cohortId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: cohortQueryKeys.detail(cohortId) });
      qc.invalidateQueries({ queryKey: ['orchestration', 'cohorts', 'list'] });
    },
  });
}
