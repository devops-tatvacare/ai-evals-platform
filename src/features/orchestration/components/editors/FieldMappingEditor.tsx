import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  InspectorCard,
  InspectorEmptyState,
  InspectorField,
} from '@/features/orchestration/components/inspector/InspectorPrimitives';
import { normalizeSourceKindMappingRow } from '@/features/orchestration/components/mappingStateUtils';

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

/** Field-mapping editor — author maps a target field to a recipient payload field or static value. */
export function FieldMappingEditor({ value, onChange, targetLabel }: Props) {
  const rows = value ?? [];
  const update = (idx: number, patch: Partial<FieldMapping>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const replace = (idx: number, nextRow: FieldMapping) => {
    onChange(rows.map((row, i) => (i === idx ? nextRow : row)));
  };
  const remove = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const add = () =>
    onChange([
      ...rows,
      { target_field: '', source_kind: 'payload', payload_field: '' },
    ]);

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      {rows.length === 0 ? (
        <InspectorEmptyState>
          No mappings — click Add to bind a {targetLabel ?? 'target field'}.
        </InspectorEmptyState>
      ) : null}
      {rows.map((row, idx) => (
        <InspectorCard key={idx}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <FieldCell label={targetLabel ?? 'Target field'}>
                  <Input
                    value={row.target_field}
                    onChange={(e) =>
                      update(idx, { target_field: e.target.value })
                    }
                    placeholder="target field"
                  />
                </FieldCell>
              </div>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="rounded-[var(--radius-default)] border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] transition-colors hover:border-[var(--color-error)]/30 hover:bg-[var(--color-error)]/5 hover:text-[var(--color-error)]"
                aria-label={`Remove mapping ${idx + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
              <FieldCell label="Source">
                <Select
                  value={row.source_kind}
                  onChange={(next) =>
                    replace(
                      idx,
                      normalizeSourceKindMappingRow(
                        row,
                        next === 'static' ? 'static' : 'payload',
                      ),
                    )
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
          </div>
        </InspectorCard>
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
    <InspectorField label={label} className="gap-1">
      {children}
    </InspectorField>
  );
}
