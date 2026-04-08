import { apiRequest } from './client';
import type {
  EvalReviewDetail,
  ReviewDraftUpdate,
  RunReviewContext,
} from '@/types';

export async function fetchRunReviewContext(runId: string): Promise<RunReviewContext> {
  return apiRequest<RunReviewContext>(`/api/reviews/runs/${runId}`);
}

export async function createRunReviewDraft(runId: string): Promise<EvalReviewDetail> {
  return apiRequest<EvalReviewDetail>(`/api/reviews/runs/${runId}/draft`, {
    method: 'POST',
  });
}

export async function fetchReviewDetail(reviewId: string): Promise<EvalReviewDetail> {
  return apiRequest<EvalReviewDetail>(`/api/reviews/${reviewId}`);
}

export async function saveReviewDraft(reviewId: string, payload: ReviewDraftUpdate): Promise<EvalReviewDetail> {
  return apiRequest<EvalReviewDetail>(`/api/reviews/${reviewId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function finalizeReview(reviewId: string, payload: ReviewDraftUpdate): Promise<EvalReviewDetail> {
  return apiRequest<EvalReviewDetail>(`/api/reviews/${reviewId}/finalize`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function discardReviewDraft(reviewId: string): Promise<{ deleted: boolean; reviewId: string }> {
  return apiRequest<{ deleted: boolean; reviewId: string }>(`/api/reviews/${reviewId}`, {
    method: 'DELETE',
  });
}
