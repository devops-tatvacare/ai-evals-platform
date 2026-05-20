/** Severity tier shown on segment / field critique tables. */
export type SeverityTier = 'NONE' | 'MINOR' | 'MODERATE' | 'CRITICAL';

/** 0–1 fractions render as percentages; whole numbers pass through. */
export function formatScore(value: number): string {
  if (value <= 1) return `${(value * 100).toFixed(0)}%`;
  return String(value);
}

/** Maps a score to a CSS-variable colour. Accepts fractions or 0–100 values. */
export function getScoreColor(value: number): string {
  const v = value > 1 ? value / 100 : value;
  if (v >= 0.7) return 'var(--color-success)';
  if (v >= 0.4) return 'var(--color-warning)';
  return 'var(--color-error)';
}

/** Stringifies a critique cell value for table display. */
export function formatCritiqueValue(value: unknown): string {
  if (value == null) return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
