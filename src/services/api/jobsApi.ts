/**
 * Jobs API client — submit, track, and poll background jobs.
 *
 * Backend returns camelCase via Pydantic alias_generator.
 */
import { apiRequest } from './client';

export interface Job {
  id: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: { current: number; total: number; message: string };
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const jobsApi = {
  async submit(jobType: string, params: Record<string, unknown>): Promise<Job> {
    return apiRequest<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ jobType, params }),
    });
  },

  async list(status?: string): Promise<Job[]> {
    const query = status ? `?status=${status}` : '';
    return apiRequest<Job[]>(`/api/jobs${query}`);
  },

  async get(jobId: string): Promise<Job> {
    return apiRequest<Job>(`/api/jobs/${jobId}`);
  },

  async cancel(jobId: string): Promise<void> {
    await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  },
};
