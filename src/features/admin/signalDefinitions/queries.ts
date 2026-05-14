import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSignalDefinition,
  deleteSignalDefinition,
  listSignalDefinitions,
  updateSignalDefinition,
  type CreateSignalDefinitionRequest,
  type SignalDefinitionListResponse,
  type SignalDefinitionRow,
  type UpdateSignalDefinitionRequest,
} from '@/services/api/signalDefinitions';

/**
 * TanStack Query hooks for the signal-definitions admin screen (Phase 11C).
 * Every mutation invalidates the list key; the backend re-projects the
 * Sherlock manifest on each write so a new signal_type reaches the schema
 * endpoint without a reboot.
 */
const SIGNAL_DEFINITIONS_KEY = ['analyticsAdmin', 'signalDefinitions'] as const;

export function useSignalDefinitions() {
  return useQuery<SignalDefinitionListResponse>({
    queryKey: SIGNAL_DEFINITIONS_KEY,
    queryFn: listSignalDefinitions,
  });
}

export function useCreateSignalDefinition() {
  const queryClient = useQueryClient();
  return useMutation<SignalDefinitionRow, Error, CreateSignalDefinitionRequest>({
    mutationFn: createSignalDefinition,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SIGNAL_DEFINITIONS_KEY });
    },
  });
}

export function useUpdateSignalDefinition() {
  const queryClient = useQueryClient();
  return useMutation<
    SignalDefinitionRow,
    Error,
    { id: string; body: UpdateSignalDefinitionRequest }
  >({
    mutationFn: ({ id, body }) => updateSignalDefinition(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SIGNAL_DEFINITIONS_KEY });
    },
  });
}

export function useDeleteSignalDefinition() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => deleteSignalDefinition(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SIGNAL_DEFINITIONS_KEY });
    },
  });
}
