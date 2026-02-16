/**
 * Centralized status/verdict color map.
 * References CSS custom properties so colors respond to light/dark theme.
 * For use in JS contexts (inline styles, chart configs) where CSS vars are needed.
 */

// For inline style usage: returns CSS variable reference string
export const STATUS_COLORS = {
  // Verdicts
  pass: 'var(--color-verdict-pass)',
  softFail: 'var(--color-verdict-soft-fail)',
  hardFail: 'var(--color-verdict-fail)',
  critical: 'var(--color-verdict-critical)',
  na: 'var(--color-verdict-na)',

  // Difficulty
  easy: 'var(--color-level-easy)',
  medium: 'var(--color-level-medium)',
  hard: 'var(--color-level-hard)',

  // Job status
  running: 'var(--color-info)',
  completed: 'var(--color-success)',
  completedWithErrors: 'var(--color-warning)',
  failed: 'var(--color-error)',
  interrupted: 'var(--color-warning)',
  cancelled: 'var(--color-warning)',

  // Recovery
  good: 'var(--color-success)',
  partial: 'var(--color-warning)',
  failedRecovery: 'var(--color-error)',
  notNeeded: 'var(--color-verdict-na)',

  // Friction cause
  user: 'var(--color-info)',
  bot: 'var(--color-error)',

  // Efficiency
  efficient: 'var(--color-verdict-pass)',
  acceptable: 'var(--color-level-easy)',
  friction: 'var(--color-verdict-soft-fail)',
  broken: 'var(--color-verdict-critical)',

  // Intent
  correct: 'var(--color-verdict-pass)',
  incorrect: 'var(--color-verdict-fail)',

  // Fallback
  default: 'var(--color-verdict-na)',
} as const;

// Category accent colors (eval categories, chart series)
export const CATEGORY_ACCENT_COLORS: Record<string, string> = {
  quantity_ambiguity: 'var(--color-accent-purple)',
  multi_meal_single_message: 'var(--color-accent-cyan)',
  correction_contradiction: 'var(--color-accent-orange)',
  edit_after_confirmation: 'var(--color-accent-pink)',
  future_time_rejection: 'var(--color-accent-teal)',
  contextual_without_context: 'var(--color-accent-indigo)',
  composite_dish: 'var(--color-accent-lime)',
};

// Tag accent colors for MessageTagBadge and similar components
export const TAG_ACCENT_COLORS = [
  'var(--color-accent-blue)',
  'var(--color-accent-purple)',
  'var(--color-accent-pink)',
  'var(--color-accent-orange)',
  'var(--color-accent-sky)',
  'var(--color-accent-fuchsia)',
  'var(--color-accent-rose)',
  'var(--color-accent-amber)',
  'var(--color-accent-cyan)',
  'var(--color-accent-indigo)',
] as const;

/**
 * Resolve a CSS variable to its computed hex value.
 * For Recharts/canvas which need resolved hex values, not CSS var() strings.
 */
export function resolveColor(cssVar: string): string {
  if (typeof window === 'undefined') return cssVar;
  const varName = cssVar.replace(/^var\(/, '').replace(/\)$/, '');
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || cssVar;
}
