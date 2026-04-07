/**
 * Report color utilities.
 * Uses CSS variables for theme-awareness; hex fallbacks for Recharts/canvas.
 */

import { resolveColor } from '@/utils/statusColors';

/** Dynamic metric color based on score threshold. */
export const METRIC_COLOR = (value: number): string => {
  if (value >= 80) return 'var(--color-success, #10B981)';
  if (value >= 60) return 'var(--color-warning, #F59E0B)';
  return 'var(--color-error, #EF4444)';
};

/** Resolved hex for Recharts (no CSS var support). */
export const METRIC_HEX = (value: number): string => {
  if (value >= 80) return resolveColor('var(--color-success)');
  if (value >= 60) return resolveColor('var(--color-warning)');
  return resolveColor('var(--color-error)');
};

export const VERDICT_COLORS: Record<string, string> = {
  PASS: resolveColor('var(--color-verdict-pass)'),
  'NOT APPLICABLE': resolveColor('var(--color-verdict-na)'),
  'SOFT FAIL': resolveColor('var(--color-verdict-soft-fail)'),
  'HARD FAIL': resolveColor('var(--color-verdict-fail)'),
  CRITICAL: resolveColor('var(--color-verdict-critical)'),
  EFFICIENT: resolveColor('var(--color-verdict-pass)'),
  ACCEPTABLE: resolveColor('var(--color-level-easy)'),
  INCOMPLETE: resolveColor('var(--color-verdict-na)'),
  FRICTION: resolveColor('var(--color-verdict-soft-fail)'),
  BROKEN: resolveColor('var(--color-verdict-fail)'),
  FAIL: resolveColor('var(--color-verdict-fail)'),
  ERROR: resolveColor('var(--color-verdict-na)'),
};

export const SEVERITY_COLORS: Record<string, string> = {
  LOW: resolveColor('var(--color-verdict-na)'),
  MEDIUM: resolveColor('var(--color-warning)'),
  HIGH: resolveColor('var(--color-error)'),
  CRITICAL: resolveColor('var(--color-verdict-critical)'),
};

export const GAP_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  UNDERSPEC: { bg: 'bg-[var(--surface-info)]', text: 'text-[var(--color-info)]' },
  SILENT: { bg: 'bg-[var(--surface-warning)]', text: 'text-[var(--color-warning)]' },
  LEAKAGE: { bg: 'bg-[var(--surface-error)]', text: 'text-[var(--color-error)]' },
  CONFLICTING: { bg: 'bg-[var(--surface-brand-subtle)]', text: 'text-[var(--text-brand)]' },
};

/** Gap type → hex color for dot indicators and segmented bars. */
export const GAP_TYPE_DOT_COLORS: Record<string, string> = {
  UNDERSPEC: resolveColor('var(--color-gap-underspec)'),
  SILENT: resolveColor('var(--color-gap-silent)'),
  LEAKAGE: resolveColor('var(--color-gap-leakage)'),
  CONFLICTING: resolveColor('var(--color-gap-conflicting)'),
};

export const PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  P0: { bg: 'bg-[var(--priority-p0-bg)]', border: 'border-[var(--priority-p0-border)]', text: 'text-[var(--priority-p0-text)]', label: 'P0 \u00b7 CRITICAL' },
  P1: { bg: 'bg-[var(--priority-p1-bg)]', border: 'border-[var(--priority-p1-border)]', text: 'text-[var(--priority-p1-text)]', label: 'P1 \u00b7 HIGH' },
  P2: { bg: 'bg-[var(--priority-p2-bg)]', border: 'border-[var(--priority-p2-border)]', text: 'text-[var(--priority-p2-text)]', label: 'P2 \u00b7 MEDIUM' },
};

export const RECOVERY_COLORS: Record<string, string> = {
  GOOD: resolveColor('var(--color-success)'),
  PARTIAL: resolveColor('var(--color-warning)'),
  FAILED: resolveColor('var(--color-error)'),
  'NOT NEEDED': resolveColor('var(--color-verdict-na)'),
  NOT_NEEDED: resolveColor('var(--color-verdict-na)'), // backward compat with cached reports
};

export const DIFFICULTY_COLORS: Record<string, string> = {
  EASY: resolveColor('var(--color-level-easy)'),
  MEDIUM: resolveColor('var(--color-level-medium)'),
  HARD: resolveColor('var(--color-level-hard)'),
  CRACK: resolveColor('var(--color-accent-purple)'),
};

/** Priority → accent color for dot indicators and accent strips. */
export const PRIORITY_DOT_COLORS: Record<string, string> = {
  P0: 'var(--priority-p0-accent)',
  P1: 'var(--priority-p1-accent)',
  P2: 'var(--priority-p2-accent)',
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
