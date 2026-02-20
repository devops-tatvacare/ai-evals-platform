import { useMemo } from 'react';
import { computeAllMetrics, type ListingMetrics } from '../metrics';
import type { Listing, AIEvaluation } from '@/types';

/**
 * Hook to compute metrics for a listing.
 * Accepts the AIEvaluation separately (fetched from eval_runs API).
 * Returns null if AI evaluation hasn't been run yet.
 */
export function useListingMetrics(
  listing: Listing | null,
  aiEval?: AIEvaluation | null,
): ListingMetrics | null {
  return useMemo(() => {
    // Need listing with original transcript and AI-generated transcript from eval
    if (!listing?.transcript || !aiEval?.judgeOutput) {
      return null;
    }

    // Only compute if AI eval completed successfully
    if (aiEval.status !== 'completed') {
      return null;
    }

    // Construct TranscriptData-compatible shape from judgeOutput
    const judgeTranscriptData = {
      fullTranscript: aiEval.judgeOutput.transcript,
      segments: aiEval.judgeOutput.segments ?? [],
    } as unknown as import('@/types').TranscriptData;

    return computeAllMetrics(
      listing.transcript,
      judgeTranscriptData
    );
  }, [listing?.transcript, aiEval]);
}
