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
        bg: 'bg-emerald-500/10',
        text: 'text-emerald-400',
        bar: 'bg-emerald-500',
      };
    case 'good':
      return {
        bg: 'bg-green-500/10',
        text: 'text-green-400',
        bar: 'bg-green-500',
      };
    case 'fair':
      return {
        bg: 'bg-amber-500/10',
        text: 'text-amber-400',
        bar: 'bg-amber-500',
      };
    case 'poor':
      return {
        bg: 'bg-red-500/10',
        text: 'text-red-400',
        bar: 'bg-red-500',
      };
  }
}
