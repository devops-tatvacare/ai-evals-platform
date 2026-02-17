import { apiRequest, apiUpload } from './client';
import type {
  Run, EvalRun, ThreadEvalRow, AdversarialEvalRow,
  SummaryStats, TrendEntry, ApiLogEntry,
  PreviewResponse,
} from '@/types';

// --- Unified EvalRun queries ---

export interface EvalRunQueryParams {
  app_id?: string;
  eval_type?: string;
  listing_id?: string;
  session_id?: string;
  evaluator_id?: string;
  status?: string;
  command?: string;
  limit?: number;
  offset?: number;
}

export async function fetchEvalRuns(params?: EvalRunQueryParams): Promise<EvalRun[]> {
  const q = new URLSearchParams();
  if (params?.app_id) q.set('app_id', params.app_id);
  if (params?.eval_type) q.set('eval_type', params.eval_type);
  if (params?.listing_id) q.set('listing_id', params.listing_id);
  if (params?.session_id) q.set('session_id', params.session_id);
  if (params?.evaluator_id) q.set('evaluator_id', params.evaluator_id);
  if (params?.status) q.set('status', params.status);
  if (params?.command) q.set('command', params.command);
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.offset) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest<EvalRun[]>(`/api/eval-runs${qs ? `?${qs}` : ''}`);
}

export async function fetchEvalRun(runId: string): Promise<EvalRun> {
  return apiRequest<EvalRun>(`/api/eval-runs/${runId}`);
}

export async function deleteEvalRun(runId: string): Promise<{ deleted: boolean; run_id: string }> {
  return apiRequest(`/api/eval-runs/${runId}`, { method: 'DELETE' });
}

/** Fetch eval runs for a specific listing */
export async function fetchRunsByListing(listingId: string): Promise<EvalRun[]> {
  return fetchEvalRuns({ listing_id: listingId });
}

/** Fetch eval runs for a specific session */
export async function fetchRunsBySession(sessionId: string): Promise<EvalRun[]> {
  return fetchEvalRuns({ session_id: sessionId });
}

/** Fetch the latest eval run of a specific type for a listing */
export async function fetchLatestRun(params: {
  listing_id?: string;
  session_id?: string;
  eval_type?: string;
  evaluator_id?: string;
}): Promise<EvalRun | undefined> {
  const runs = await fetchEvalRuns({ ...params, limit: 1 });
  return runs[0];
}

// --- Legacy: Runs (backward compat, delegates to unified) ---

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

// --- CSV Preview ---

export async function previewCsv(file: File): Promise<PreviewResponse> {
  return apiUpload<PreviewResponse>('/api/eval-runs/preview', file, file.name);
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
