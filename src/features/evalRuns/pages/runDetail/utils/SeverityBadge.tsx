/**
 * Severity badge shared by segment and field critique tables. Renders 'NONE'
 * as a 'Match' chip so the absence of a discrepancy reads positively.
 */
export function SeverityBadge({ severity }: { severity: string }) {
  const s = (severity ?? 'none').toUpperCase();
  const styles: Record<string, { bg: string; text: string }> = {
    NONE: { bg: 'var(--surface-success)', text: 'var(--color-success)' },
    MINOR: { bg: 'var(--bg-tertiary)', text: 'var(--text-muted)' },
    MODERATE: { bg: 'var(--surface-warning)', text: 'var(--color-warning)' },
    CRITICAL: { bg: 'var(--surface-error)', text: 'var(--color-error)' },
  };
  const st = styles[s] ?? styles.MINOR;
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase inline-block"
      style={{ backgroundColor: st.bg, color: st.text }}
    >
      {s === 'NONE' ? 'Match' : s}
    </span>
  );
}
