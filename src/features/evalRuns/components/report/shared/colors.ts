/**
 * Report color utilities.
 * Uses CSS variables for theme-awareness; hex fallbacks for Recharts/canvas.
 */

/** Dynamic metric color based on score threshold. */
export const METRIC_COLOR = (value: number): string => {
  if (value >= 80) return 'var(--color-success, #10B981)';
  if (value >= 60) return 'var(--color-warning, #F59E0B)';
  return 'var(--color-error, #EF4444)';
};

/** Resolved hex for Recharts (no CSS var support). */
export const METRIC_HEX = (value: number): string => {
  if (value >= 80) return '#10B981';
  if (value >= 60) return '#F59E0B';
  return '#EF4444';
};

export const VERDICT_COLORS: Record<string, string> = {
  // Correctness
  PASS: '#16a34a',
  'NOT APPLICABLE': '#6b7280',
  'SOFT FAIL': '#ca8a04',
  'HARD FAIL': '#dc2626',
  CRITICAL: '#7c2d12',
  // Efficiency
  EFFICIENT: '#16a34a',
  ACCEPTABLE: '#3b82f6',
  INCOMPLETE: '#6b7280',
  FRICTION: '#ca8a04',
  BROKEN: '#dc2626',
  // Adversarial
  FAIL: '#dc2626',
  ERROR: '#6b7280',
};

export const SEVERITY_COLORS: Record<string, string> = {
  LOW: '#6b7280',
  MEDIUM: '#F59E0B',
  HIGH: '#EF4444',
  CRITICAL: '#7c2d12',
};

export const GAP_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  UNDERSPEC: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  SILENT: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300' },
  LEAKAGE: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  CONFLICTING: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300' },
};

/** Gap type → hex color for dot indicators and segmented bars. */
export const GAP_TYPE_DOT_COLORS: Record<string, string> = {
  UNDERSPEC: '#3b82f6',
  SILENT: '#f59e0b',
  LEAKAGE: '#ef4444',
  CONFLICTING: '#8b5cf6',
};

export const PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  P0: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-800 dark:text-red-300', label: 'P0 \u00b7 CRITICAL' },
  P1: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-800 dark:text-amber-300', label: 'P1 \u00b7 HIGH' },
  P2: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-800 dark:text-blue-300', label: 'P2 \u00b7 MEDIUM' },
};

export const RECOVERY_COLORS: Record<string, string> = {
  GOOD: '#10B981',
  PARTIAL: '#F59E0B',
  FAILED: '#EF4444',
  'NOT NEEDED': '#6b7280',
  NOT_NEEDED: '#6b7280', // backward compat with cached reports
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: '#10B981',
  MEDIUM: '#F59E0B',
  HARD: '#EF4444',
};

/** Priority → dot color for table rows. */
export const PRIORITY_DOT_COLORS: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f59e0b',
  P2: '#3b82f6',
};

/** Map issue rank (1-based) to priority key. */
export function rankToPriority(rank: number): 'P0' | 'P1' | 'P2' {
  if (rank <= 1) return 'P0';
  if (rank <= 3) return 'P1';
  return 'P2';
}

/**
 * Parse a free-text estimatedImpact string into structured segments.
 * Input examples:
 *   "-12 `single_item_one_table` failures, -2 `multi_food_multi_tables` failures"
 *   "-1 allow_edit_after_log failure, +1 task completion"
 * Returns: [{ arrow: '↓', count: '12', label: 'single_item_one_table failures' }, ...]
 * Falls back to a single raw-text entry if pattern doesn't match.
 */
export interface ImpactSegment {
  arrow: string;
  count: string;
  label: string;
}

/** Convert raw verdict/cause/recovery keys to display-friendly labels. */
export function verdictLabel(key: string): string {
  if (key === 'NOT APPLICABLE') return 'N/A';
  if (key === 'NOT_NEEDED' || key === 'NOT NEEDED') return 'Not Needed';
  return key
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function parseImpactSegments(raw: string): ImpactSegment[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const results: ImpactSegment[] = [];

  for (const part of parts) {
    // Strip backticks
    const clean = part.replace(/`/g, '');
    const match = clean.match(/^([+-])(\d+)\s+(.+)$/);
    if (match) {
      results.push({
        arrow: match[1] === '-' ? '↓' : '↑',
        count: match[2],
        label: match[3],
      });
    } else {
      // Fallback: no pattern match, show as-is
      results.push({ arrow: '', count: '', label: clean });
    }
  }

  return results;
}
