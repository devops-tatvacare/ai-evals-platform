import { useEffect, useMemo, useState } from 'react';

import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import {
  fetchCohortSources,
} from '@/services/api/orchestration';
import type {
  CohortSource,
  WorkflowType,
} from '@/features/orchestration/types';
import { cn } from '@/utils';

interface CohortQueryConfig {
  source_ref?: string;
  filters?: Array<{ column?: string; op?: string; value?: unknown }>;
  payload_fields?: string[];
  lookback_hours?: number | null;
  lookback_column?: string;
  consent_gate_channel?: string;
  // legacy fields tolerated on read; never written by this editor
  source_table?: string;
  id_column?: string;
  payload_columns?: string[];
}

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
  const [sources, setSources] = useState<CohortSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchCohortSources({ workflowType, appId })
      .then((rows) => {
        if (!alive) return;
        setSources(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSources([]);
        setError(err instanceof Error ? err.message : 'Failed to load sources');
      });
    return () => {
      alive = false;
    };
  }, [workflowType, appId]);

  const selected = useMemo(
    () => sources?.find((s) => s.sourceRef === value.source_ref) ?? null,
    [sources, value.source_ref],
  );

  const setSourceRef = (next: string) => {
    // Preserve filters / payload selections when the operator switches
    // sources only if the columns still exist on the new source. Otherwise
    // drop them — silently retaining columns the new source can't project
    // would create a definition that fails validation at publish time.
    const nextSource = sources?.find((s) => s.sourceRef === next) ?? null;
    const allowedPayload = new Set(nextSource?.allowedPayloadColumns ?? []);
    const allowedFilters = new Set(nextSource?.allowedFilterColumns ?? []);
    onChange({
      ...value,
      source_ref: next,
      payload_fields: (value.payload_fields ?? []).filter((c) =>
        allowedPayload.has(c),
      ),
      filters: (value.filters ?? []).filter((f) =>
        f.column ? allowedFilters.has(f.column) : false,
      ),
      lookback_column: nextSource?.allowedLookbackColumns.includes(
        value.lookback_column ?? '',
      )
        ? value.lookback_column
        : undefined,
    });
  };

  const togglePayloadField = (col: string) => {
    const current = new Set(value.payload_fields ?? []);
    if (current.has(col)) current.delete(col);
    else current.add(col);
    onChange({ ...value, payload_fields: Array.from(current) });
  };

  const sourceOptions = useMemo(
    () =>
      (sources ?? []).map((s) => ({
        value: s.sourceRef,
        label: s.displayLabel,
        meta: s.sourceRef,
        searchText: `${s.displayLabel} ${s.sourceRef} ${s.description}`,
      })),
    [sources],
  );

  return (
    <div className="flex flex-col gap-3">
      <Field label="Source">
        <Combobox
          value={value.source_ref ?? ''}
          onChange={setSourceRef}
          options={sourceOptions}
          placeholder={sources === null ? 'Loading sources…' : 'Pick a source'}
          disabled={sources === null}
        />
        {selected ? (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {selected.description}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 text-xs text-[var(--color-error)]">{error}</p>
        ) : null}
      </Field>

      {selected ? (
        <>
          <Field label="Payload fields">
            <p className="mb-1 text-[11px] text-[var(--text-secondary)]">
              Recipient payload exposed to downstream nodes. Engineering-owned —
              tenants cannot project arbitrary columns.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selected.allowedPayloadColumns.map((col) => {
                const active = (value.payload_fields ?? []).includes(col);
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => togglePayloadField(col)}
                    className={cn(
                      'rounded-[var(--radius-default)] border px-2 py-0.5 text-xs',
                      active
                        ? 'border-[var(--color-brand)] bg-[var(--bg-brand-soft)] text-[var(--text-brand)]'
                        : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                    )}
                  >
                    {col}
                  </button>
                );
              })}
            </div>
          </Field>

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
        </>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-[var(--text-primary)]">
        {label}
      </span>
      {children}
    </div>
  );
}
