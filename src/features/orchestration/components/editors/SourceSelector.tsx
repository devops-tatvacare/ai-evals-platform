import { useCallback, useMemo, useState } from 'react';

import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DatasetSourcePicker } from '@/features/orchestration/components/datasets/DatasetSourcePicker';
import {
  InspectorCard,
  InspectorEmptyState,
  InspectorField,
  InspectorSection,
} from '@/features/orchestration/components/inspector/InspectorPrimitives';
import {
  formatListInputValue,
  normalizeFilterValueForOperator,
  parseListInputValue,
} from '@/features/orchestration/components/editors/sourceSelectorValueUtils';
import {
  COHORT_OPERATOR_OPTIONS_BY_TYPE,
  defaultCohortOperator,
  isListOperator,
} from '@/features/orchestration/components/editors/operatorContracts';
import type {
  CohortColumnType,
  CohortSource,
  WorkflowType,
} from '@/features/orchestration/types';
import { cn } from '@/utils';

interface CohortQueryConfig {
  source_ref?: string;
  filters?: CohortFilter[];
  payload_fields?: string[];
  lookback_hours?: number | null;
  lookback_column?: string;
  consent_gate_channel?: string;
  // legacy fields tolerated on read; never written by this editor
  source_table?: string;
  id_column?: string;
  payload_columns?: string[];
}

interface CohortFilter {
  column?: string;
  op?: string;
  value?: unknown;
}

interface SourceColumn {
  name: string;
  type: CohortColumnType;
}

const TYPE_LABELS: Record<CohortColumnType, string> = {
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  datetime: 'datetime',
  string: 'text',
};

interface Props {
  workflowType: WorkflowType;
  appId: string;
  value: CohortQueryConfig;
  onChange(next: CohortQueryConfig): void;
}

/**
 * Phase 11 (Commit 2) — `source.cohort_query` editor.
 *
 * Authors pick a registered cohort source by ``source_ref``; the editor
 * surfaces the catalog-defined allowed payload columns, allowed filter
 * columns, and allowed lookback columns so authors never have to know the
 * underlying table name. Source-specific routing config (legacy
 * ``next_node_id``) does not appear here — the visual graph determines
 * the successor (Phase 11 §6.1).
 */
export function SourceSelector({ workflowType, appId, value, onChange }: Props) {
  // The picker owns the source-catalog fetch; we only need the *selected*
  // entry here so the payload-field / lookback-column UI can hydrate from
  // the entry's allowed-column lists. Stash whatever the picker hands
  // back when the operator switches sources.
  const [selected, setSelected] = useState<CohortSource | null>(null);

  const filterColumns = useMemo<SourceColumn[]>(() => {
    if (!selected) return [];
    const descriptorColumns = selected.schemaDescriptor?.columns ?? [];
    if (descriptorColumns.length > 0) {
      return descriptorColumns
        .filter((c) => selected.allowedFilterColumns.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type }));
    }
    return selected.allowedFilterColumns.map((name) => ({ name, type: 'string' }));
  }, [selected]);

  const payloadFieldOptions = useMemo(() => {
    if (!selected) return [];
    const declaredTypes = new Map(
      (selected.schemaDescriptor?.columns ?? []).map((column) => [column.name, column.type]),
    );
    return selected.allowedPayloadColumns.map((column) => ({
      value: column,
      label: column,
      meta: declaredTypes.has(column)
        ? TYPE_LABELS[declaredTypes.get(column) as CohortColumnType]
        : undefined,
    }));
  }, [selected]);

  const setSourceRef = (next: string, entry: CohortSource) => {
    setSelected(entry);
    // Switching sources clears filters / payload selections — column sets
    // diverge between the static catalog and dataset entries, and silently
    // retaining columns the new source can't project would create a
    // definition that fails validation at publish time. (v1: clear and
    // let the operator reselect; migrating column-by-column is a follow-up.)
    onChange({
      ...value,
      source_ref: next,
      payload_fields: [],
      filters: [],
      lookback_column: entry.allowedLookbackColumns.includes(
        value.lookback_column ?? '',
      )
        ? value.lookback_column
        : undefined,
    });
  };

  // When the picker's catalog fetch resolves, look up the saved
  // ``source_ref`` so the payload-field / lookback-column UI can hydrate
  // without the operator re-clicking the dropdown.
  const handleSourcesLoaded = useCallback(
    (sources: CohortSource[]) => {
      const ref = value.source_ref;
      if (!ref) return;
      const match = sources.find((s) => s.sourceRef === ref) ?? null;
      setSelected((prev) => (prev?.sourceRef === match?.sourceRef ? prev : match));
    },
    [value.source_ref],
  );

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Source"
        description="Successor routing comes from the visual graph — connect this node to the next node on the canvas."
      >
        <DatasetSourcePicker
          appId={appId}
          workflowType={workflowType}
          value={value.source_ref ?? null}
          onChange={setSourceRef}
          onSourcesLoaded={handleSourcesLoaded}
        />
      </Field>

      {selected ? (
        <>
          <Section
            title="Payload fields"
            description="Recipient payload exposed to downstream nodes. Engineering-owned — tenants cannot project arbitrary columns."
          >
            {payloadFieldOptions.length === 0 ? (
              <InspectorEmptyState>
                This source does not expose selectable payload fields.
              </InspectorEmptyState>
            ) : (
              <Combobox
                multi
                value={value.payload_fields ?? []}
                onChange={(next) => onChange({ ...value, payload_fields: next })}
                options={payloadFieldOptions}
                placeholder="Select payload fields"
              />
            )}
          </Section>

          <Section
            title="Filters"
            description="Narrow the selected source before the workflow starts processing recipients."
          >
            <FilterEditor
              columns={filterColumns}
              value={value.filters ?? []}
              onChange={(filters) => onChange({ ...value, filters })}
            />
          </Section>

          <Section
            title="Lookback window"
            description="Optionally restrict the source to recent rows before downstream dispatch and delivery."
          >
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
              <Field label="Lookback (hours)">
                <Input
                  type="number"
                  min={0}
                  value={value.lookback_hours ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      lookback_hours:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  placeholder="optional — leave blank for no lookback"
                />
              </Field>

              {selected.allowedLookbackColumns.length > 0 ? (
                <Field label="Lookback column">
                  <Combobox
                    value={value.lookback_column ?? ''}
                    onChange={(next) =>
                      onChange({ ...value, lookback_column: next })
                    }
                    options={selected.allowedLookbackColumns.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                    placeholder="Pick a timestamp column"
                  />
                </Field>
              ) : null}
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <InspectorField label={label} description={description}>
      {children}
    </InspectorField>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <InspectorSection title={title} description={description}>
      {children}
    </InspectorSection>
  );
}

function FilterEditor({
  columns,
  value,
  onChange,
}: {
  columns: SourceColumn[];
  value: CohortFilter[];
  onChange(next: CohortFilter[]): void;
}) {
  const byName = useMemo(
    () => new Map(columns.map((c) => [c.name, c])),
    [columns],
  );

  const makeDefaultFilter = (): CohortFilter | null => {
    const first = columns[0];
    if (!first) return null;
      return {
        column: first.name,
        op: defaultCohortOperator(first.type),
        value: defaultValue(first.type),
      };
  };

  const addFilter = () => {
    const next = makeDefaultFilter();
    if (next) onChange([...value, next]);
  };

  const updateAt = (idx: number, patch: Partial<CohortFilter>) => {
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? (
        <InspectorEmptyState>
          No filters. The workflow starts with every row in the selected source.
        </InspectorEmptyState>
      ) : null}
      {value.map((filter, idx) => {
        const column = byName.get(filter.column ?? '') ?? columns[0];
        const type = column?.type ?? 'string';
        const operator = filter.op ?? defaultCohortOperator(type);
        return (
          <InspectorCard key={idx}>
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
                <Field label="Column">
                  <Select
                    value={filter.column ?? ''}
                    onChange={(columnName) => {
                      const nextColumn = byName.get(columnName);
                        const nextType = nextColumn?.type ?? 'string';
                        updateAt(idx, {
                          column: columnName,
                          op: defaultCohortOperator(nextType),
                          value: defaultValue(nextType),
                        });
                    }}
                    options={columns.map((c) => ({
                      value: c.name,
                      label: `${c.name} (${TYPE_LABELS[c.type]})`,
                    }))}
                    placeholder="Column"
                    size="sm"
                  />
                </Field>
                <Field label="Operator">
                  <Select
                    value={operator}
                    onChange={(op) =>
                      updateAt(idx, {
                        op,
                        value: normalizeFilterValueForOperator(filter.value, type, op, defaultValue),
                      })
                    }
                    options={COHORT_OPERATOR_OPTIONS_BY_TYPE[type]}
                    placeholder="Operator"
                    size="sm"
                  />
                </Field>
                <Field label="Value">
                  <FilterValueInput
                    type={type}
                    op={operator}
                    value={filter.value}
                    onChange={(nextValue) => updateAt(idx, { value: nextValue })}
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className={cn(
                  'rounded-[var(--radius-default)] border border-[var(--border-default)]',
                  'px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]',
                )}
              >
                Remove
              </button>
            </div>
          </InspectorCard>
        );
      })}
      <div>
        <button
          type="button"
          onClick={addFilter}
          disabled={columns.length === 0}
          className={cn(
            'rounded-[var(--radius-default)] border border-[var(--border-default)]',
            'px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          Add filter
        </button>
      </div>
    </div>
  );
}

function FilterValueInput({
  type,
  op,
  value,
  onChange,
}: {
  type: CohortColumnType;
  op: string;
  value: unknown;
  onChange(next: unknown): void;
}) {
  if (isListOperator(op)) {
    return (
      <ListFilterValueInput type={type} value={value} onChange={onChange} />
    );
  }
  if (type === 'boolean') {
    return (
      <Select
        value={value === false ? 'false' : 'true'}
        onChange={(next) => onChange(next === 'true')}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        size="sm"
      />
    );
  }
  const inputType = type === 'integer' || type === 'number' ? 'number' : 'text';
  return (
    <Input
      type={inputType}
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => {
        if (type === 'integer' || type === 'number') {
          onChange(e.target.value === '' ? null : Number(e.target.value));
          return;
        }
        onChange(e.target.value);
      }}
      placeholder={type === 'datetime' ? '2026-05-01T00:00:00Z' : 'Value'}
    />
  );
}

function ListFilterValueInput({
  type,
  value,
  onChange,
}: {
  type: CohortColumnType;
  value: unknown;
  onChange(next: unknown): void;
}) {
  const initialValue = formatListInputValue(value);

  return (
    <Input
      key={`${type}:${initialValue}`}
      type="text"
      defaultValue={initialValue}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(parseListInputValue(raw, type));
      }}
      placeholder="a, b, c"
    />
  );
}

function defaultValue(type: CohortColumnType): unknown {
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  return '';
}
