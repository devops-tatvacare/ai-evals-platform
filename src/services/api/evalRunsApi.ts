import { apiRequest } from './client';
import type {
  Run, ThreadEvalRow, AdversarialEvalRow,
  SummaryStats, TrendEntry, ApiLogEntry,
} from '@/types';

// --- Runs ---

export async function fetchRuns(params?: {
  command?: string;
  limit?: number;
  offset?: number;
}): Promise<{ runs: Run[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.command) q.set('command', params.command);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  const runs = await apiRequest<Run[]>(`/api/eval-runs${qs ? `?${qs}` : ''}`);
  return { runs, total: runs.length };
}

export async function fetchRun(runId: string): Promise<Run> {
  return apiRequest<Run>(`/api/eval-runs/${runId}`);
}

export async function deleteRun(runId: string): Promise<{ deleted: boolean; run_id: string }> {
  return apiRequest(`/api/eval-runs/${runId}`, { method: 'DELETE' });
}

// --- Thread evaluations ---

export async function fetchRunThreads(runId: string): Promise<{
  run_id: string;
  evaluations: ThreadEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/eval-runs/${runId}/threads`);
}

// --- Adversarial evaluations ---

export async function fetchRunAdversarial(runId: string): Promise<{
  run_id: string;
  evaluations: AdversarialEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/eval-runs/${runId}/adversarial`);
}

// --- Thread history ---

export async function fetchThreadHistory(threadId: string): Promise<{
  thread_id: string;
  history: ThreadEvalRow[];
  total: number;
}> {
  return apiRequest(`/api/threads/${threadId}/history`);
}

// --- Stats & Trends ---

export async function fetchStats(): Promise<SummaryStats> {
  return apiRequest<SummaryStats>('/api/eval-runs/stats/summary');
}

export async function fetchTrends(days = 30): Promise<{ data: TrendEntry[]; days: number }> {
  return apiRequest(`/api/eval-runs/trends?days=${days}`);
}

// --- Logs ---

export async function fetchLogs(params?: {
  run_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: ApiLogEntry[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.run_id) q.set('run_id', params.run_id);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest(`/api/eval-runs/logs${qs ? `?${qs}` : ''}`);
}

export async function fetchRunLogs(runId: string, limit = 200): Promise<{
  run_id: string;
  logs: ApiLogEntry[];
}> {
  return apiRequest(`/api/eval-runs/${runId}/logs?limit=${limit}`);
}

export async function deleteLogs(runId?: string): Promise<{ deleted: number }> {
  const qs = runId ? `?run_id=${runId}` : '';
  return apiRequest(`/api/eval-runs/logs${qs}`, { method: 'DELETE' });
}
