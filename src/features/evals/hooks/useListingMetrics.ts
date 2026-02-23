import { useMemo } from 'react';
import {
  computeUploadFlowMetrics,
  computeApiFlowMetrics,
  computeHumanAdjustedUploadMetrics,
  computeHumanAdjustedApiMetrics,
  type MetricResult,
  getRating,
  getRatingForErrorRate,
} from '../metrics';
import type {
  Listing,
  AIEvaluation,
  TranscriptData,
  HumanReview,
  SegmentReviewItem,
  FieldReviewItem,
} from '@/types';

/**
 * Hook to compute metrics for a listing.
 * Returns a flat MetricResult[] suitable for MetricsBar, or null if
 * evaluation hasn't been run / hasn't completed yet.
 *
 * Upload flow → [Match, WER, CER]
 * API flow    → [Field Accuracy, Recall, Precision, WER, CER]
 *
 * When metricsSource='human' and humanReview exists, returns
 * human-adjusted metrics instead of AI-computed ones.
 */
export function useListingMetrics(
  listing: Listing | null,
  aiEval?: AIEvaluation | null,
  humanReview?: HumanReview | null,
  metricsSource?: 'ai' | 'human',
): MetricResult[] | null {
  return useMemo(() => {
    if (!aiEval || aiEval.status !== 'completed' || !aiEval.judgeOutput) return null;

    const isApi = aiEval.flowType === 'api';
    const wantHuman = metricsSource === 'human' && !!humanReview;

    // --- Human-adjusted metrics ---
    if (wantHuman) {
      // Shortcut: use pre-computed adjustedMetrics from summary if available
      const adjusted = humanReview.summary?.adjustedMetrics;
      if (adjusted && Object.keys(adjusted).length > 0) {
        return buildMetricsFromSummary(adjusted, isApi);
      }

      // Otherwise recompute from review items
      const items = humanReview.result?.items ?? [];

      if (isApi) {
        const apiTranscript = listing?.apiResponse?.input || '';
        const judgeTranscript = aiEval.judgeOutput.transcript || '';
        const fieldCritiques = aiEval.critique?.fieldCritiques ?? [];
        if (!apiTranscript && !judgeTranscript) return null;

        const fieldReviews = new Map<string, FieldReviewItem>();
        for (const item of items) {
          if ('fieldPath' in item) {
            fieldReviews.set(item.fieldPath, item as FieldReviewItem);
          }
        }

        return computeHumanAdjustedApiMetrics(
          apiTranscript,
          judgeTranscript,
          fieldCritiques,
          fieldReviews,
        );
      }

      // Upload flow
      if (!listing?.transcript) return null;
      const judgeTranscriptData = {
        fullTranscript: aiEval.judgeOutput.transcript,
        segments: aiEval.judgeOutput.segments ?? [],
      } as unknown as TranscriptData;

      const segmentReviews = new Map<number, SegmentReviewItem>();
      for (const item of items) {
        if ('segmentIndex' in item) {
          segmentReviews.set(item.segmentIndex, item as SegmentReviewItem);
        }
      }

      return computeHumanAdjustedUploadMetrics(
        listing.transcript,
        judgeTranscriptData,
        segmentReviews,
      );
    }

    // --- Standard AI metrics ---
    if (isApi) {
      const apiTranscript = listing?.apiResponse?.input || '';
      const judgeTranscript = aiEval.judgeOutput.transcript || '';
      const fieldCritiques = aiEval.critique?.fieldCritiques ?? [];

      if (!apiTranscript && !judgeTranscript) return null;

      return computeApiFlowMetrics(apiTranscript, judgeTranscript, fieldCritiques);
    }

    // Upload flow: segment-based transcripts
    if (!listing?.transcript) return null;

    const judgeTranscriptData = {
      fullTranscript: aiEval.judgeOutput.transcript,
      segments: aiEval.judgeOutput.segments ?? [],
    } as unknown as TranscriptData;

    return computeUploadFlowMetrics(listing.transcript, judgeTranscriptData);
  }, [listing, aiEval, humanReview, metricsSource]);
}

/**
 * Build MetricResult[] directly from pre-computed adjustedMetrics summary.
 * Keys match metric IDs: match, wer, cer, fieldAccuracy, extractionRecall, extractionPrecision.
 */
function buildMetricsFromSummary(
  adjusted: Record<string, number>,
  isApi: boolean,
): MetricResult[] {
  if (isApi) {
    const accuracy = adjusted.fieldAccuracy ?? 0;
    const recall = adjusted.extractionRecall ?? 0;
    const precision = adjusted.extractionPrecision ?? 0;
    const werVal = adjusted.wer ?? 0;
    const cerVal = adjusted.cer ?? 0;

    return [
      {
        id: 'fieldAccuracy',
        label: 'Field Accuracy',
        value: accuracy,
        displayValue: `${accuracy.toFixed(1)}%`,
        maxValue: 100,
        percentage: accuracy,
        rating: getRating(accuracy),
        description: 'Human-adjusted field accuracy',
      },
      {
        id: 'extractionRecall',
        label: 'Recall',
        value: recall,
        displayValue: `${recall.toFixed(1)}%`,
        maxValue: 100,
        percentage: recall,
        rating: getRating(recall),
        description: 'Extraction recall',
      },
      {
        id: 'extractionPrecision',
        label: 'Precision',
        value: precision,
        displayValue: `${precision.toFixed(1)}%`,
        maxValue: 100,
        percentage: precision,
        rating: getRating(precision),
        description: 'Human-adjusted precision',
      },
      {
        id: 'wer',
        label: 'WER',
        value: werVal,
        displayValue: werVal.toFixed(2),
        maxValue: 1,
        percentage: (1 - werVal) * 100,
        rating: getRatingForErrorRate(werVal),
        description: 'Word Error Rate',
      },
      {
        id: 'cer',
        label: 'CER',
        value: cerVal,
        displayValue: cerVal.toFixed(2),
        maxValue: 1,
        percentage: (1 - cerVal) * 100,
        rating: getRatingForErrorRate(cerVal),
        description: 'Character Error Rate',
      },
    ];
  }

  // Upload flow
  const werVal = adjusted.wer ?? 0;
  const cerVal = adjusted.cer ?? 0;
  const matchVal = adjusted.match ?? (100 - werVal * 100);

  return [
    {
      id: 'match',
      label: 'Match',
      value: matchVal,
      displayValue: `${matchVal.toFixed(1)}%`,
      maxValue: 100,
      percentage: matchVal,
      rating: getRating(matchVal),
      description: 'Human-adjusted match',
    },
    {
      id: 'wer',
      label: 'WER',
      value: werVal,
      displayValue: werVal.toFixed(2),
      maxValue: 1,
      percentage: (1 - werVal) * 100,
      rating: getRatingForErrorRate(werVal),
      description: 'Word Error Rate',
    },
    {
      id: 'cer',
      label: 'CER',
      value: cerVal,
      displayValue: cerVal.toFixed(2),
      maxValue: 1,
      percentage: (1 - cerVal) * 100,
      rating: getRatingForErrorRate(cerVal),
      description: 'Character Error Rate',
    },
  ];
}
