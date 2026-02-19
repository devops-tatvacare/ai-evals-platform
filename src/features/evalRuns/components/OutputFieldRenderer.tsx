import type { OutputFieldDef } from '@/types/evalRuns';
import VerdictBadge from './VerdictBadge';

interface OutputFieldRendererProps {
  /** Field definitions from evaluator's output_schema */
  schema: OutputFieldDef[];
  /** Actual output values from evaluation result */
  output: Record<string, unknown>;
  /**
   * Rendering mode:
   * - 'card': Full card with labels and descriptions (detail view)
   * - 'inline': Compact key:value pairs (expanded table row)
   * - 'badge': Just the primary field as a badge (table cell)
   */
  mode: 'card' | 'inline' | 'badge';
  /** If set, only render this field (for table cell mode) */
  fieldKey?: string;
}

export function OutputFieldRenderer({ schema, output, mode, fieldKey }: OutputFieldRendererProps) {
  const fields = fieldKey
    ? schema.filter(f => f.key === fieldKey)
    : schema.filter(f => f.displayMode !== 'hidden');

  if (mode === 'badge') {
    const field = fields[0];
    if (!field) return null;
    const value = output[field.key];
    return <FieldValue field={field} value={value} compact />;
  }

  if (mode === 'inline') {
    return (
      <div className="space-y-1">
        {fields.map(f => (
          <div key={f.key} className="flex items-start gap-2 text-sm">
            <span className="text-[var(--text-muted)] shrink-0 font-medium">
              {f.label || f.key}:
            </span>
            <FieldValue field={f} value={output[f.key]} />
          </div>
        ))}
      </div>
    );
  }

  // mode === 'card'
  return (
    <div className="space-y-2">
      {fields.map(f => (
        <div key={f.key} className="flex items-start gap-3">
          <div className="min-w-[120px]">
            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              {f.label || f.key}
            </span>
            {f.description && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{f.description}</p>
            )}
          </div>
          <FieldValue field={f} value={output[f.key]} />
        </div>
      ))}
    </div>
  );
}

function FieldValue({ field, value, compact }: { field: OutputFieldDef; value: unknown; compact?: boolean }) {
  if (value == null) return <span className="text-[var(--text-muted)]">&mdash;</span>;

  switch (field.type) {
    case 'number': {
      const num = Number(value);
      const color = getScoreColor(num, field.thresholds);
      if (compact) {
        const display = num <= 1 ? `${(num * 100).toFixed(0)}%` : String(num);
        return <span style={{ color }} className="font-semibold">{display}</span>;
      }
      return (
        <div className="flex items-center gap-2">
          <span style={{ color }} className="font-semibold text-sm">
            {num <= 1 ? `${(num * 100).toFixed(0)}%` : num}
          </span>
          {field.thresholds && <ScoreBar value={num} thresholds={field.thresholds} />}
        </div>
      );
    }

    case 'boolean':
      return value
        ? <span className="text-[var(--color-success)] font-medium text-sm">Pass</span>
        : <span className="text-[var(--color-error)] font-medium text-sm">Fail</span>;

    case 'text': {
      const str = String(value);
      // If it looks like a short verdict (uppercase or short string), render as badge
      // Omit category so VerdictBadge auto-detects — works for both built-in and custom verdicts
      if (str.length <= 30 && str === str.toUpperCase().replace(/[^A-Z_ ]/g, '')) {
        return <VerdictBadge verdict={str} />;
      }
      if (compact && str.length > 40) {
        return <span className="text-sm text-[var(--text-primary)] truncate max-w-[200px] inline-block">{str}</span>;
      }
      return <span className="text-sm text-[var(--text-primary)] break-words">{str}</span>;
    }

    case 'array':
      if (compact) return <span className="text-sm text-[var(--text-muted)]">[{Array.isArray(value) ? value.length : 0} items]</span>;
      return (
        <pre className="text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded p-2 max-h-32 overflow-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      );

    default:
      return <span className="text-sm">{JSON.stringify(value)}</span>;
  }
}

function getScoreColor(value: number, thresholds?: { green: number; yellow?: number; red?: number }): string {
  if (!thresholds) {
    const v = value > 1 ? value / 100 : value;
    if (v >= 0.7) return 'var(--color-success)';
    if (v >= 0.4) return 'var(--color-warning)';
    return 'var(--color-error)';
  }
  if (value >= thresholds.green) return 'var(--color-success)';
  if (thresholds.yellow != null && value >= thresholds.yellow) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function ScoreBar({ value, thresholds }: { value: number; thresholds: { green: number } }) {
  const pct = Math.min(100, Math.max(0, (value / thresholds.green) * 100));
  const color = getScoreColor(value, thresholds);
  return (
    <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full max-w-[80px]">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
