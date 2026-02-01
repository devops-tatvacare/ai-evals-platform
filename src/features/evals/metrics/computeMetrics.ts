/**
 * Compute all metrics for a listing
 * 
 * This orchestrator computes all available metrics from transcript data.
 */

import { getRating, type ListingMetrics, type MetricResult } from './types';
import { calculateWERMetric, calculateCERMetric } from './wordErrorRate';
import type { TranscriptData } from '@/types';

/**
 * Convert transcript to plain text for comparison
 */
function transcriptToText(transcript: TranscriptData): string {
  return transcript.segments.map(s => s.text).join(' ');
}

/**
 * Calculate simple match metric from WER (100 - WER)
 */
function calculateMatchMetric(wer: MetricResult): MetricResult {
  // Match percentage is inverse of WER
  const percentage = Math.max(0, 100 - wer.value);
  
  return {
    id: 'match',
    label: 'Match',
    value: percentage,
    displayValue: `${percentage.toFixed(1)}%`,
    maxValue: 100,
    percentage,
    rating: getRating(percentage),
    description: 'Overall transcript similarity (100 - WER)',
  };
}

/**
 * Compute all metrics for a listing's transcripts
 */
export function computeAllMetrics(
  originalTranscript: TranscriptData,
  llmTranscript: TranscriptData
): ListingMetrics {
  const originalText = transcriptToText(originalTranscript);
  const llmText = transcriptToText(llmTranscript);

  // WER and CER computed fresh
  const wer = calculateWERMetric(originalText, llmText);
  const cer = calculateCERMetric(originalText, llmText);

  // Match metric derived from WER
  const match = calculateMatchMetric(wer);

  return {
    match,
    wer,
    cer,
    computedAt: new Date(),
  };
}
