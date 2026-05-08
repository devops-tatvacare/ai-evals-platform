/**
 * BPCardWidget — read-only render of a Kaira `bp_card` payload for the
 * adversarial transcript pane. Mirrors the production Goodflip BP card.
 *
 * Live chat surface (Phase 5 of widget-parity plan) will reuse this same
 * component when bp_card support lands there.
 */

import { Activity } from 'lucide-react';
import { cn } from '@/utils';

interface Props {
  data: Record<string, unknown>;
  /** When true, the confirm button is rendered but visually disabled. */
  readOnly?: boolean;
}

function num(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? `${v}` : v.toFixed(0);
  if (typeof v === 'string' && v.trim()) return v;
  return '–';
}

export function BPCardWidget({ data, readOnly = true }: Props) {
  const systolic = num(data['systolic']);
  const diastolic = num(data['diastolic']);
  const pulse = data['pulse'] != null ? num(data['pulse']) : null;
  const measuredAt = (data['consumed_label'] || data['measured_label'] || data['label']) as string | undefined;

  return (
    <div
      className={cn(
        'mt-3 max-w-md rounded-xl border bg-[var(--bg-primary)] overflow-hidden',
        'border-[var(--border-subtle)]',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)]">
        <Activity className="h-4 w-4 text-[var(--color-info)]" />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Blood Pressure</span>
        {measuredAt && (
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">{measuredAt}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex flex-col items-center">
          <div className="text-[20px] font-bold text-[var(--text-primary)]">{systolic}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Systolic</div>
        </div>
        <div className="flex flex-col items-center">
          <div className="text-[20px] font-bold text-[var(--text-primary)]">{diastolic}</div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Diastolic</div>
        </div>
        {pulse != null && (
          <div className="flex flex-col items-center">
            <div className="text-[20px] font-bold text-[var(--text-primary)]">{pulse}</div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Pulse</div>
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-[var(--border-subtle)] px-3 py-3">
        <button
          type="button"
          disabled
          className={cn(
            'flex flex-1 items-center justify-center rounded-md px-3 py-2 text-[12px] font-semibold',
            'bg-[var(--interactive-primary)] text-[var(--text-on-color)]',
            readOnly && 'cursor-not-allowed opacity-60',
          )}
        >
          Yes log this BP reading
        </button>
        <button
          type="button"
          disabled
          className={cn(
            'flex flex-1 items-center justify-center rounded-md border px-3 py-2 text-[12px] font-semibold',
            'border-[var(--interactive-primary)] bg-[var(--bg-primary)] text-[var(--interactive-primary)]',
            'cursor-not-allowed opacity-40',
          )}
        >
          No edit this BP reading
        </button>
      </div>
    </div>
  );
}
