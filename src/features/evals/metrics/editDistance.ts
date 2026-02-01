/**
 * Edit Distance (Levenshtein Distance) Metrics
 * 
 * Uses fastest-levenshtein for efficient distance computation.
 */

import { distance } from 'fastest-levenshtein';

export interface EditDistanceResult {
  distance: number;
  maxLength: number;
  similarity: number; // 0-1, higher is better
  rating: 'excellent' | 'good' | 'fair' | 'poor';
}

/**
 * Compute Levenshtein distance using fastest-levenshtein
 */
export function computeEditDistance(a: string, b: string): number {
  // Normalize: lowercase and trim
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  return distance(s1, s2);
}

/**
 * Calculate edit distance with similarity score and rating
 */
export function calculateEditDistanceMetrics(original: string, generated: string): EditDistanceResult {
  const dist = computeEditDistance(original, generated);
  const maxLength = Math.max(original.length, generated.length);
  
  // Similarity: 1 - normalized distance
  const similarity = maxLength === 0 ? 1 : 1 - (dist / maxLength);
  
  // Rating based on similarity thresholds
  let rating: EditDistanceResult['rating'];
  if (similarity >= 0.9) {
    rating = 'excellent';
  } else if (similarity >= 0.75) {
    rating = 'good';
  } else if (similarity >= 0.5) {
    rating = 'fair';
  } else {
    rating = 'poor';
  }

  return { distance: dist, maxLength, similarity, rating };
}

/**
 * Get color scheme for rating
 */
export function getRatingColor(rating: EditDistanceResult['rating']): {
  bg: string;
  text: string;
  border: string;
} {
  switch (rating) {
    case 'excellent':
      return {
        bg: 'bg-[var(--color-success-light)]',
        text: 'text-[var(--color-success)]',
        border: 'border-[var(--color-success)]/30',
      };
    case 'good':
      return {
        bg: 'bg-[var(--color-success-light)]',
        text: 'text-[var(--color-success)]',
        border: 'border-[var(--color-success)]/30',
      };
    case 'fair':
      return {
        bg: 'bg-[var(--color-warning-light)]',
        text: 'text-[var(--color-warning)]',
        border: 'border-[var(--color-warning)]/30',
      };
    case 'poor':
      return {
        bg: 'bg-[var(--color-error-light)]',
        text: 'text-[var(--color-error)]',
        border: 'border-[var(--color-error)]/30',
      };
  }
}
