import type { ReactNode } from 'react';
import MetricInfo from './MetricInfo';

interface StatPillProps {
  label: string;
  value: ReactNode;
  /**
   * Optional reviewed value. When provided and different from `value`, the AI
   * `value` renders struck-through + muted and `humanValue` renders beside it
   * in brand color — same AI-vs-human visual language as `VerdictChip`.
   */
  humanValue?: ReactNode;
  metricKey?: string;
  color?: string;
}

function nodeKey(node: ReactNode): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return JSON.stringify(node);
}

export function StatPill({ label, value, humanValue, metricKey, color }: StatPillProps) {
  const hasOverride = humanValue != null && nodeKey(humanValue) !== nodeKey(value);
  const valueStyle = color && !hasOverride ? { color } : undefined;

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2">
      <div className="flex items-center gap-1">
        <p className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</p>
        {metricKey && <MetricInfo metricKey={metricKey} />}
      </div>
      {hasOverride ? (
        <p className="mt-0.5 flex items-baseline gap-1.5 leading-tight" title="Reviewed — AI value struck-through">
          <span className="text-sm font-semibold text-[var(--text-muted)] line-through">{value}</span>
          <span className="text-lg font-bold text-[var(--text-brand)]">{humanValue}</span>
        </p>
      ) : (
        <p
          className={`text-lg font-bold mt-0.5 leading-tight${color ? '' : ' text-[var(--text-primary)]'}`}
          style={valueStyle}
        >
          {value}
        </p>
      )}
    </div>
  );
}
