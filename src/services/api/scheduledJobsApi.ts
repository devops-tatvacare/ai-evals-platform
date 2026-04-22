/**
 * Scheduled jobs API client — CRUD + fire-now + toggle + registry.
 * All routes gated on `schedule:manage` server-side; tenant-scoped.
 */
import { apiRequest } from './client';
import type {
  Schedule,
  ScheduleCreateInput,
  ScheduleDetailResponse,
  ScheduleRegistryResponse,
  ScheduleUpdateInput,
} from '@/features/admin/scheduledJobs/types';

const BASE = '/api/scheduled-jobs';

export const scheduledJobsApi = {
  async list(appId?: string): Promise<Schedule[]> {
    const qs = appId ? `?app_id=${encodeURIComponent(appId)}` : '';
    return apiRequest<Schedule[]>(`${BASE}${qs}`);
  },

  async get(id: string): Promise<ScheduleDetailResponse> {
    return apiRequest<ScheduleDetailResponse>(`${BASE}/${encodeURIComponent(id)}`);
  },

  async create(payload: ScheduleCreateInput): Promise<Schedule> {
    return apiRequest<Schedule>(BASE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async update(id: string, payload: ScheduleUpdateInput): Promise<Schedule> {
    return apiRequest<Schedule>(`${BASE}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async remove(id: string): Promise<void> {
    await apiRequest<void>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async toggle(id: string): Promise<Schedule> {
    return apiRequest<Schedule>(`${BASE}/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    });
  },

  async fireNow(id: string): Promise<Schedule> {
    return apiRequest<Schedule>(`${BASE}/${encodeURIComponent(id)}/fire-now`, {
      method: 'POST',
    });
  },

  async registry(): Promise<ScheduleRegistryResponse> {
    return apiRequest<ScheduleRegistryResponse>(`${BASE}/registry`);
  },
};
