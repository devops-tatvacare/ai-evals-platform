import { apiRequest } from './client';

/** Communication-cap policy — caps how often a single contact may be reached
 *  per (tenant, app) within a rolling window. Shape mirrors the Phase 2
 *  `CommCapPolicyRead` backend schema exactly. */
export interface CommCapPolicy {
  id: string;
  tenantId: string;
  appId: string;
  maxCount: number;
  windowSeconds: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

export interface CommCapPolicyWrite {
  tenantId: string;
  appId: string;
  maxCount: number;
  windowSeconds: number;
  isActive: boolean;
}

export async function listCommCapPolicies(): Promise<CommCapPolicy[]> {
  return apiRequest<CommCapPolicy[]>('/api/admin/orchestration/comm-cap/list');
}

export async function upsertCommCapPolicy(
  body: CommCapPolicyWrite,
): Promise<CommCapPolicy> {
  return apiRequest<CommCapPolicy>('/api/admin/orchestration/comm-cap', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
