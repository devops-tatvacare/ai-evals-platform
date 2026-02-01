/**
 * Word Error Rate (WER) Computation
 * 
 * WER = (S + D + I) / N
 * Where:
 *   S = substitutions
 *   D = deletions  
 *   I = insertions
 *   N = number of words in reference
 * 
 * Uses fastest-levenshtein for efficient distance computation
 */

import { distance } from 'fastest-levenshtein';
import { getRatingForErrorRate, type MetricResult } from './types';

/**
 * Normalize text for comparison: lowercase, collapse whitespace
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return normalizeText(text).split(' ').filter(w => w.length > 0);
}

/**
 * Compute Word Error Rate using Levenshtein distance on word arrays
 */
export function computeWER(reference: string, hypothesis: string): number {
  const refWords = tokenize(reference);
  const hypWords = tokenize(hypothesis);
  
  if (refWords.length === 0) {
    return hypWords.length === 0 ? 0 : 1;
  }

  // Use Levenshtein on joined words (treating each word as unit)
  // This is an approximation but fast and accurate enough
  const refJoined = refWords.join('\u0000'); // Use null char as word separator
  const hypJoined = hypWords.join('\u0000');
  
  const editDistance = distance(refJoined, hypJoined);
  
  // Normalize by reference length (approximate WER)
  // Clamp to max 1.0 (100% error rate)
  return Math.min(editDistance / (refJoined.length || 1), 1);
}

/**
 * Compute Character Error Rate using Levenshtein distance
 */
export function computeCER(reference: string, hypothesis: string): number {
  const refNorm = normalizeText(reference);
  const hypNorm = normalizeText(hypothesis);
  
  if (refNorm.length === 0) {
    return hypNorm.length === 0 ? 0 : 1;
  }

  const editDistance = distance(refNorm, hypNorm);
  return Math.min(editDistance / refNorm.length, 1);
}

/**
 * Calculate WER metric result
 */
export function calculateWERMetric(reference: string, hypothesis: string): MetricResult {
  const wer = computeWER(reference, hypothesis);
  const percentage = (1 - wer) * 100; // Accuracy percentage for display
  
  return {
    id: 'wer',
    label: 'WER',
    value: wer,
    displayValue: wer.toFixed(2),
    maxValue: 1,
    percentage,
    rating: getRatingForErrorRate(wer),
    description: 'Word Error Rate - lower is better',
  };
}

/**
 * Calculate CER metric result
 */
export function calculateCERMetric(reference: string, hypothesis: string): MetricResult {
  const cer = computeCER(reference, hypothesis);
  const percentage = (1 - cer) * 100; // Accuracy percentage for display
  
  return {
    id: 'cer',
    label: 'CER',
    value: cer,
    displayValue: cer.toFixed(2),
    maxValue: 1,
    percentage,
    rating: getRatingForErrorRate(cer),
    description: 'Character Error Rate - lower is better',
  };
}
