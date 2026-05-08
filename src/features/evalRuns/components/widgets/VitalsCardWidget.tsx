/**
 * VitalsCardWidget — read-only render of a Kaira `vitals_card` payload.
 * Schema is open (vitals can include weight, height, hr, spo2, temp, ...);
 * we render every numeric/string field as a labelled cell.
 */

import { HeartPulse } from 'lucide-react';
import { cn } from '@/utils';

interface Props {
  data: Record<string, unknown>;
  readOnly?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  weight_kg: 'Weight',
  height_cm: 'Height',
  bmi: 'BMI',
  heart_rate_bpm: 'Heart rate',
  spo2: 'SpO₂',
  temperature_c: 'Temp',
  blood_glucose: 'Glucose',
  hba1c: 'HbA1c',
};

const FIELD_UNITS: Record<string, string> = {
  weight_kg: 'kg',
  height_cm: 'cm',
  heart_rate_bpm: 'bpm',
  spo2: '%',
  temperature_c: '°C',
};

function isMeasurementField(key: string, value: unknown): value is number | string {
  if (key === 'consumed_at' || key === 'consumed_label' || key === 'measured_label' || key === 'label') return false;
  return typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0);
}

export function VitalsCardWidget({ data, readOnly = true }: Props) {
  const fields = Object.entries(data).filter(([k, v]) => isMeasurementField(k, v));
  const measuredLabel = (data['consumed_label'] || data['measured_label'] || data['label']) as string | undefined;

  return (
    <div className="mt-3 max-w-md rounded-xl border bg-[var(--bg-primary)] overflow-hidden border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)]">
        <HeartPulse className="h-4 w-4 text-[var(--color-success)]" />
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">Vitals</span>
        {measuredLabel && (
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">{measuredLabel}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        {fields.length === 0 ? (
          <div className="col-span-2 text-[12px] text-[var(--text-muted)]">No measurements parsed</div>
        ) : (
          fields.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <div className="text-[15px] font-bold text-[var(--text-primary)]">
                {String(v)}
                {FIELD_UNITS[k] && (
                  <span className="text-[10px] font-medium text-[var(--text-muted)] ml-1">{FIELD_UNITS[k]}</span>
                )}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {FIELD_LABELS[k] ?? k.replace(/_/g, ' ')}
              </div>
            </div>
          ))
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
          Yes, save these
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
          I want to edit something
        </button>
      </div>
    </div>
  );
}
