import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { COHORT_FILTER_OPS } from '@/features/orchestration/contracts/nodeConfig';
import type { CohortFilter } from '@/services/api/orchestrationCohorts';

interface Props {
  value: CohortFilter[];
  onChange: (next: CohortFilter[]) => void;
  disabled?: boolean;
}

const OP_OPTIONS = COHORT_FILTER_OPS.map((op) => ({ value: op, label: op }));
const LIST_OPS: ReadonlySet<string> = new Set(['in', 'not_in']);

function isListOp(op: string): boolean {
  return LIST_OPS.has(op);
}

function coerceValue(op: string, raw: string): unknown {
  if (isListOp(op)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Numeric coercion for the obvious comparators — keep strings for eq/neq
  // because cohort columns are heterogeneous and the backend casts via the
  // catalog. Misclassification is a soft bug (filter fails at compile time
  // with a clear error), not a footgun.
  if (op === 'gte' || op === 'gt' || op === 'lte' || op === 'lt') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

function valueToInputString(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value == null) return '';
  return String(value);
}

export function CohortFiltersEditor({ value, onChange, disabled }: Props) {
  function updateFilter(index: number, patch: Partial<CohortFilter>) {
    const next = [...value];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function removeFilter(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addFilter() {
    onChange([...value, { column: '', op: 'eq', value: '' }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          No filters yet. Add one to narrow the audience.
        </p>
      ) : null}
      {value.map((f, idx) => (
        <div key={idx} className="flex items-start gap-2">
          <Input
            value={f.column}
            onChange={(e) => updateFilter(idx, { column: e.target.value })}
            placeholder="column"
            disabled={disabled}
            className="flex-[2]"
          />
          <div className="flex-1">
            <Select
              value={f.op}
              onChange={(op) =>
                updateFilter(idx, {
                  op: op as CohortFilter['op'],
                  // Reset value when switching to/from list ops so a stale
                  // string doesn't fail the server-side shape check.
                  value: isListOp(op) === isListOp(f.op) ? f.value : isListOp(op) ? [] : '',
                })
              }
              options={OP_OPTIONS}
            />
          </div>
          <Input
            value={valueToInputString(f.value)}
            onChange={(e) => updateFilter(idx, { value: coerceValue(f.op, e.target.value) })}
            placeholder={isListOp(f.op) ? 'comma, separated, values' : 'value'}
            disabled={disabled}
            className="flex-[2]"
          />
          <button
            type="button"
            onClick={() => removeFilter(idx)}
            disabled={disabled}
            aria-label="Remove filter"
            className="mt-1 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--color-error)] disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={addFilter}
        disabled={disabled}
        className="self-start gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add filter
      </Button>
    </div>
  );
}
