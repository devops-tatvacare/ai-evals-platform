import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';

interface Props {
  value: string;
  onChange(next: string): void;
  /** Allowed payload column names. When provided, renders a Combobox
   *  and warns if the operator's value is not in the list. */
  fieldOptions?: string[];
  placeholder?: string;
}

/**
 * Phase 11 (Commit 2) — single-field payload reference picker.
 *
 * Used by dispatch-node configs that pick a payload field name (e.g.
 * `recipient_field` for WATI / Bolna / SMS). When the upstream source's
 * allowed payload columns are known, the picker is a dropdown; otherwise
 * it falls back to a free-text input.
 */
export function PayloadFieldPicker({
  value,
  onChange,
  fieldOptions,
  placeholder,
}: Props) {
  if (fieldOptions && fieldOptions.length > 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <Combobox
          value={value}
          onChange={onChange}
          options={fieldOptions.map((f) => ({ value: f, label: f }))}
          placeholder={placeholder ?? 'payload field'}
        />
        {value && !fieldOptions.includes(value) ? (
          <span className="text-[11px] text-[var(--color-warning)]">
            {value} is not in the source&apos;s declared payload columns.
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'payload field'}
    />
  );
}
