import { type ReactNode, useId } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils';
import { useRightOverlay } from '@/hooks';
import { Button } from './Button';
import { Select } from './Select';
import { Combobox } from './Combobox';

export type FilterControl =
  | 'text'
  | 'select'
  | 'multi-select'
  | 'date-range'
  | 'segmented';

export interface FilterFieldOption {
  value: string;
  label: string;
}

export interface FilterFieldConfig {
  key: string;
  label: string;
  control: FilterControl;
  /** For date-range: the two URL keys, e.g. ['from', 'to']. */
  fields?: [string, string];
  options?: FilterFieldOption[];
  placeholder?: string;
}

export interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  fields: FilterFieldConfig[];
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onClear?: () => void;
  /** Custom slot rendered at the top of the body (e.g. app-specific async option loader status). */
  header?: ReactNode;
  /** Width in pixels. Default 400. */
  widthPx?: number;
}

const INPUT_CLASS =
  'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50';

export function FilterPanel({
  open,
  onClose,
  title = 'Filters',
  fields,
  values,
  onChange,
  onClear,
  header,
  widthPx = 400,
}: FilterPanelProps) {
  const titleId = useId();
  const ariaProps = useRightOverlay(open, { onClose, labelledBy: titleId });

  return (
    <aside
      {...ariaProps}
      aria-hidden={!open}
      className={cn(
        'fixed right-0 top-0 bottom-0 z-[var(--z-overlay)] flex flex-col border-l border-[var(--border-default)] bg-[var(--bg-primary)] shadow-2xl transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
      style={{ width: `${widthPx}px` }}
    >
      <header className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
        <h2 id={titleId} className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          aria-label="Close filters"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {header && <div className="mb-3">{header}</div>}
        <div className="flex flex-col gap-4">
          {fields.map((field) => (
            <FilterField
              key={field.key}
              field={field}
              values={values}
              onChange={onChange}
            />
          ))}
        </div>
      </div>

      {onClear && (
        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear all
          </Button>
        </footer>
      )}
    </aside>
  );
}

function FilterField({
  field,
  values,
  onChange,
}: {
  field: FilterFieldConfig;
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {field.label}
      </label>
      <FilterControlInput field={field} values={values} onChange={onChange} />
    </div>
  );
}

function FilterControlInput({
  field,
  values,
  onChange,
}: {
  field: FilterFieldConfig;
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const primaryKey = field.fields?.[0] ?? field.key;

  switch (field.control) {
    case 'text': {
      const current = typeof values[primaryKey] === 'string' ? (values[primaryKey] as string) : '';
      return (
        <input
          type="text"
          value={current}
          onChange={(e) => onChange({ [primaryKey]: e.target.value })}
          placeholder={field.placeholder}
          className={INPUT_CLASS}
        />
      );
    }
    case 'select': {
      const current = typeof values[primaryKey] === 'string' ? (values[primaryKey] as string) : '';
      return (
        <Select
          size="sm"
          value={current}
          onChange={(v) => onChange({ [primaryKey]: v })}
          options={field.options ?? []}
          placeholder={field.placeholder ?? 'Select...'}
        />
      );
    }
    case 'multi-select': {
      const raw = values[primaryKey];
      const current = Array.isArray(raw) ? (raw as string[]) : [];
      return (
        <Combobox
          multi
          size="sm"
          value={current}
          onChange={(next) => onChange({ [primaryKey]: next })}
          options={field.options ?? []}
          placeholder={field.placeholder ?? 'Select...'}
        />
      );
    }
    case 'date-range': {
      const [fromKey, toKey] = field.fields ?? [field.key, field.key];
      const fromVal = typeof values[fromKey] === 'string' ? (values[fromKey] as string) : '';
      const toVal = typeof values[toKey] === 'string' ? (values[toKey] as string) : '';
      return (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromVal}
            onChange={(e) => onChange({ [fromKey]: e.target.value })}
            className={INPUT_CLASS}
          />
          <span className="text-[var(--text-muted)]">–</span>
          <input
            type="date"
            value={toVal}
            onChange={(e) => onChange({ [toKey]: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
      );
    }
    case 'segmented': {
      const current = typeof values[primaryKey] === 'string' ? (values[primaryKey] as string) : '';
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((opt) => {
            const active = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ [primaryKey]: active ? '' : opt.value })}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] transition-colors',
                  active
                    ? 'border-[var(--color-brand-accent)] bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}
