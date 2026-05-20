import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listCommCapPolicies,
  upsertCommCapPolicy,
  type CommCapPolicy,
  type CommCapPolicyWrite,
} from '@/services/api/orchestrationAdmin';

const commCapKeys = {
  list: ['orchestration-admin', 'comm-cap', 'list'] as const,
};

/** All reach-limit policies the caller can see (own tenant; platform-staff
 *  see every tenant). Backend tenant-scopes for non-super-admins. */
export function useCommCapPolicies() {
  return useQuery<CommCapPolicy[]>({
    queryKey: commCapKeys.list,
    queryFn: listCommCapPolicies,
  });
}

export function useUpsertCommCapPolicy() {
  const queryClient = useQueryClient();
  return useMutation<CommCapPolicy, unknown, CommCapPolicyWrite>({
    mutationFn: upsertCommCapPolicy,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commCapKeys.list });
    },
  });
}
