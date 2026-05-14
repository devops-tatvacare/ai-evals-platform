import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  archiveConnection,
  createConnection,
  listConnections,
  rotateWebhookToken,
  testConnection,
  updateConnection,
  type Connection,
  type ConnectionTestResponse,
  type CreateConnectionBody,
  type ListConnectionsParams,
  type UpdateConnectionBody,
} from '@/services/api/orchestrationConnections';

/**
 * TanStack Query hooks for the relocated Integrations admin screen (Phase 12).
 * The list query is keyed under `['integrations', 'connections']`; every
 * mutation invalidates that prefix so the table reflects writes immediately.
 */
const CONNECTIONS_KEY = ['integrations', 'connections'] as const;

export function useConnections(params: ListConnectionsParams) {
  return useQuery<Connection[]>({
    queryKey: [...CONNECTIONS_KEY, params],
    queryFn: () => listConnections(params),
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();
  return useMutation<Connection, Error, CreateConnectionBody>({
    mutationFn: createConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();
  return useMutation<Connection, Error, { id: string; body: UpdateConnectionBody }>({
    mutationFn: ({ id, body }) => updateConnection(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: archiveConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}

export function useTestConnection() {
  return useMutation<ConnectionTestResponse, Error, string>({
    mutationFn: testConnection,
  });
}

export function useRotateToken() {
  const queryClient = useQueryClient();
  return useMutation<{ webhookUrl: string }, Error, string>({
    mutationFn: rotateWebhookToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
    },
  });
}
