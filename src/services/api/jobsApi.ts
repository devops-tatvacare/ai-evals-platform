/**
 * Jobs API client — submit, track, and poll background jobs.
 */
import { apiRequest } from './client';

export interface Job {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: { current: number; total: number; message: string };
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const jobsApi = {
  async submit(jobType: string, params: Record<string, unknown>): Promise<Job> {
    return apiRequest<Job>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ job_type: jobType, params }),
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

  /**
   * Poll a job until it reaches a terminal state (completed/failed/cancelled).
   * Calls onProgress with each update.
   */
  async pollUntilDone(
    jobId: string,
    onProgress?: (job: Job) => void,
    intervalMs: number = 2000,
  ): Promise<Job> {
    while (true) {
      const job = await this.get(jobId);
      onProgress?.(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        return job;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  },
};
