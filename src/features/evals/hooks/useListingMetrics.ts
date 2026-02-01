import { useMemo } from 'react';
import { computeAllMetrics, type ListingMetrics } from '../metrics';
import type { Listing } from '@/types';

/**
 * Hook to compute metrics for a listing
 * Returns null if AI evaluation hasn't been run yet
 */
export function useListingMetrics(listing: Listing | null): ListingMetrics | null {
  return useMemo(() => {
    // Need listing with both original transcript and AI-generated transcript
    if (!listing?.transcript || !listing?.aiEval?.llmTranscript) {
      return null;
    }

    // Only compute if AI eval completed successfully
    if (listing.aiEval.status !== 'completed') {
      return null;
    }

    return computeAllMetrics(
      listing.transcript,
      listing.aiEval.llmTranscript
    );
  }, [listing?.transcript, listing?.aiEval]);
}
