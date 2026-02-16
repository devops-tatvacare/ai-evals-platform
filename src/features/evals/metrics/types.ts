/**
 * Shared types for evaluation metrics
 */

export type MetricRating = 'excellent' | 'good' | 'fair' | 'poor';

export interface MetricResult {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  maxValue: number;
  percentage: number; // 0-100 for progress bar
  rating: MetricRating;
  description?: string;
}

export interface ListingMetrics {
  match: MetricResult;
  wer: MetricResult;
  cer: MetricResult;
  computedAt: Date;
}

/**
 * Get rating based on percentage (higher is better)
 */
export function getRating(percentage: number): MetricRating {
  if (percentage >= 90) return 'excellent';
  if (percentage >= 75) return 'good';
  if (percentage >= 50) return 'fair';
  return 'poor';
}

/**
 * Get rating for error rates (lower is better, so invert)
 */
export function getRatingForErrorRate(errorRate: number): MetricRating {
  // errorRate 0 = perfect, 1 = 100% errors
  const accuracy = (1 - errorRate) * 100;
  return getRating(accuracy);
}

/**
 * Get colors for a rating
 */
export function getRatingColors(rating: MetricRating): {
  bg: string;
  text: string;
  bar: string;
} {
  switch (rating) {
    case 'excellent':
      return {
        bg: 'bg-[var(--color-success)]/10',
        text: 'text-[var(--color-success)]',
        bar: 'bg-[var(--color-success)]',
      };
    case 'good':
      return {
        bg: 'bg-[var(--color-success)]/10',
        text: 'text-[var(--color-success)]',
        bar: 'bg-[var(--color-success)]',
      };
    case 'fair':
      return {
        bg: 'bg-[var(--color-warning)]/10',
        text: 'text-[var(--color-warning)]',
        bar: 'bg-[var(--color-warning)]',
      };
    case 'poor':
      return {
        bg: 'bg-[var(--color-error)]/10',
        text: 'text-[var(--color-error)]',
        bar: 'bg-[var(--color-error)]',
      };
  }
}
