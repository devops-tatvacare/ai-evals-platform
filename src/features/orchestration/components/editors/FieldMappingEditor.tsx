import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export type FieldMappingSource = 'payload' | 'static';

export interface FieldMapping {
  target_field: string;
  source_kind: FieldMappingSource;
  payload_field?: string;
  static_value?: string;
}

interface Props {
  value: FieldMapping[] | undefined;
  onChange(next: FieldMapping[]): void;
  /** Verbiage for the target column header — defaults to "Target field"
   *  but mutation editors customize (e.g. "LSQ field" / "EMR field"). */
  targetLabel?: string;
}

const SOURCE_OPTIONS = [
  { value: 'payload', label: 'Recipient field' },
  { value: 'static',  label: 'Static value' },
];

/**
 * Phase 11 (Commit 2) — field-mapping editor for mutation nodes.
 *
 * Used by `crm.lsq_log_activity.fields`, `clinical.emr_write.structured_fields`,
 * and any future mutation node that needs structured target-field bindings.
 *
 * Authors map a target field to either a recipient payload field or a
 * static value. The persisted shape mirrors the existing
 * ``VariableMappingField`` row structure — different verbiage, same
 * contract — so backend consumers can share resolution logic.
 */
export function FieldMappingEditor({ value, onChange, targetLabel }: Props) {
  const rows = value ?? [];
  const update = (idx: number, patch: Partial<FieldMapping>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () =>
    onChange([
      ...rows,
      { target_field: '', source_kind: 'payload', payload_field: '' },
    ]);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-default)] border border-[var(--border-default)] p-2">
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-[var(--text-secondary)]">
          No mappings — click Add to bind a {targetLabel ?? 'target field'}.
        </p>
      ) : null}
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2"
        >
          <div className="grid flex-1 grid-cols-3 gap-2">
            <FieldCell label={targetLabel ?? 'Target field'}>
              <Input
                value={row.target_field}
                onChange={(e) =>
                  update(idx, { target_field: e.target.value })
                }
                placeholder="target field"
              />
            </FieldCell>
            <FieldCell label="Source">
              <Select
                value={row.source_kind}
                onChange={(next) =>
                  update(idx, {
                    source_kind: next === 'static' ? 'static' : 'payload',
                  })
                }
                options={SOURCE_OPTIONS}
              />
            </FieldCell>
            <FieldCell
              label={row.source_kind === 'payload' ? 'Payload field' : 'Value'}
            >
              {row.source_kind === 'payload' ? (
                <Input
                  value={row.payload_field ?? ''}
                  onChange={(e) =>
                    update(idx, { payload_field: e.target.value })
                  }
                  placeholder="recipient payload field"
                />
              ) : (
                <Input
                  value={row.static_value ?? ''}
                  onChange={(e) =>
                    update(idx, { static_value: e.target.value })
                  }
                  placeholder="literal value"
                />
              )}
            </FieldCell>
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            className="text-[var(--text-muted)] hover:text-[var(--color-error)]"
            aria-label={`Remove mapping ${idx + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add mapping
      </Button>
    </div>
  );
}

function FieldCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </span>
      {children}
    </div>
  );
}
