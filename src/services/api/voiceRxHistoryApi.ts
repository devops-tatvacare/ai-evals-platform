/**
 * Voice RX History API — thin wrapper around /api/history
 * with app_id=voicerx & source_type=evaluator_run baked in.
 *
 * Backend returns a flat HistoryResponse[] array (not paginated wrapper).
 */
import type { EvaluatorRunHistory } from '@/types';
import { apiRequest } from './client';

const BASE = '/api/history';
const DEFAULT_PARAMS = 'app_id=voicerx&source_type=evaluator_run';

export async function fetchVoiceRxRuns(limit = 100): Promise<EvaluatorRunHistory[]> {
  return apiRequest<EvaluatorRunHistory[]>(
    `${BASE}?${DEFAULT_PARAMS}&limit=${limit}`,
  );
}

export async function fetchVoiceRxRunsByListing(listingId: string): Promise<EvaluatorRunHistory[]> {
  return apiRequest<EvaluatorRunHistory[]>(
    `${BASE}?${DEFAULT_PARAMS}&entity_id=${listingId}`,
  );
}

export async function fetchVoiceRxRunById(id: string): Promise<EvaluatorRunHistory | undefined> {
  try {
    return await apiRequest<EvaluatorRunHistory>(`${BASE}/${id}`);
  } catch {
    return undefined;
  }
}

export async function deleteVoiceRxRun(id: string): Promise<void> {
  await apiRequest(`${BASE}/${id}`, { method: 'DELETE' });
}
