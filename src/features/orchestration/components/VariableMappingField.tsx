import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { getAgentVariables } from '@/services/api/orchestrationConnections';
import { cn } from '@/utils';
import {
  InspectorCard,
  InspectorEmptyState,
  InspectorField,
} from './inspector/InspectorPrimitives';
import {
  normalizeSourceKindMappingRow,
  reconcileVariableMappingsToParameters,
} from './mappingStateUtils';

export type VariableMappingSource = 'payload' | 'static';

export interface VariableMapping {
  agent_variable: string;
  source_kind: VariableMappingSource;
  payload_field?: string;
  static_value?: string;
}

interface Props {
  value: VariableMapping[];
  onChange(next: VariableMapping[]): void;
  /** When set, the agent-variable field becomes a Combobox driven by
   *  GET /connections/{id}/agent-variables using the runtime-selected
   *  provider entity (`agentId` for Bolna, `templateName` for WATI).
   *  When unset, the row falls back to a free-text input — used during
   *  initial setup before a connection has been picked. */
  connectionId?: string;
  agentId?: string;
  templateName?: string;
  templateParameters?: string[];
}

const SOURCE_OPTIONS = [
  { value: 'payload', label: 'Recipient field' },
  { value: 'static', label: 'Static value' },
];

function asVariableMappings(value: unknown): VariableMapping[] {
  if (!Array.isArray(value)) return [];
  const out: VariableMapping[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const v = entry as Record<string, unknown>;
    const sourceKind: VariableMappingSource =
      v.source_kind === 'static' ? 'static' : 'payload';
    const row: VariableMapping = {
      agent_variable:
        typeof v.agent_variable === 'string' ? v.agent_variable : '',
      source_kind: sourceKind,
    };
    if (typeof v.payload_field === 'string') row.payload_field = v.payload_field;
    if (typeof v.static_value === 'string') row.static_value = v.static_value;
    out.push(row);
  }
  return out;
}

export function VariableMappingField({
  value,
  onChange,
  connectionId,
  agentId,
  templateName,
  templateParameters,
}: Props) {
  const rows = useMemo(() => {
    const parsed = asVariableMappings(value);
    if (templateParameters === undefined) {
      return parsed;
    }
    return reconcileVariableMappingsToParameters(parsed, templateParameters);
  }, [value, templateParameters]);
  const fetchKey = connectionId ? `${connectionId}:${agentId ?? ''}:${templateName ?? ''}` : null;

  const [fetchedVars, setFetchedVars] = useState<{
    key: string;
    variables: string[];
    error: string | null;
  } | null>(null);
  const agentVars =
    templateParameters ??
    (fetchKey && fetchedVars?.key === fetchKey ? fetchedVars.variables : null);
  const agentVarsError =
    templateParameters !== undefined
      ? null
      : fetchKey && fetchedVars?.key === fetchKey
        ? fetchedVars.error
        : null;

  useEffect(() => {
    if (templateParameters !== undefined || !connectionId || !fetchKey) return;
    let alive = true;
    getAgentVariables(connectionId, { agentId, templateName })
      .then((res) => {
        if (!alive) return;
        setFetchedVars({
          key: fetchKey,
          variables: res.variables,
          // Soft upstream error (e.g. Bolna 404 for the configured agent
          // id) — the endpoint returns 200 + ``error`` so we stay editable
          // but surface the cause instead of pretending nothing happened.
          error: res.error ?? null,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setFetchedVars({
          key: fetchKey,
          variables: [],
          error: err instanceof Error ? err.message : 'Failed to load agent variables',
        });
      });
    return () => {
      alive = false;
    };
  }, [connectionId, agentId, fetchKey, templateName, templateParameters]);

  const updateRow = (idx: number, patch: Partial<VariableMapping>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const replaceRow = (idx: number, nextRow: VariableMapping) => {
    onChange(rows.map((row, i) => (i === idx ? nextRow : row)));
  };
  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx));
  };
  const addRow = () => {
    onChange([
      ...rows,
      { agent_variable: '', source_kind: 'payload', payload_field: '' },
    ]);
  };

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      {rows.length === 0 ? (
        <InspectorEmptyState>
          No variable mappings — click Add to bind an agent variable.
        </InspectorEmptyState>
      ) : null}
      {rows.map((row, idx) => (
        <InspectorCard key={idx}>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <InspectorField label="Variable" className={cn('gap-1')}>
                  {agentVars && agentVars.length > 0 ? (
                    <Combobox
                      size="sm"
                      value={row.agent_variable}
                      onChange={(next) => updateRow(idx, { agent_variable: next })}
                      options={agentVars.map((v) => ({ value: v, label: v }))}
                      placeholder="Pick variable"
                    />
                  ) : (
                    <Input
                      value={row.agent_variable}
                      onChange={(e) =>
                        updateRow(idx, { agent_variable: e.target.value })
                      }
                      placeholder="agent_variable"
                    />
                  )}
                </InspectorField>
              </div>
              <Button
                variant="danger-outline"
                size="sm"
                onClick={() => removeRow(idx)}
                aria-label={`Remove mapping ${idx + 1}`}
              >
                Remove
              </Button>
            </div>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
              <InspectorField label="Source" className="gap-1">
                <Combobox
                  size="sm"
                  value={row.source_kind}
                  onChange={(next) =>
                    replaceRow(
                      idx,
                      normalizeSourceKindMappingRow(
                        row,
                        next === 'static' ? 'static' : 'payload',
                      ),
                    )
                  }
                  options={SOURCE_OPTIONS}
                  placeholder="Source"
                />
              </InspectorField>
              <InspectorField
                label={row.source_kind === 'payload' ? 'Field' : 'Value'}
                className="gap-1"
              >
                {row.source_kind === 'payload' ? (
                  <Input
                    value={row.payload_field ?? ''}
                    onChange={(e) =>
                      updateRow(idx, { payload_field: e.target.value })
                    }
                    placeholder="recipient.payload field"
                  />
                ) : (
                  <Input
                    value={row.static_value ?? ''}
                    onChange={(e) =>
                      updateRow(idx, { static_value: e.target.value })
                    }
                    placeholder="literal value"
                  />
                )}
              </InspectorField>
            </div>
          </div>
        </InspectorCard>
      ))}
      {agentVarsError ? (
        <span className="rounded-[var(--radius-default)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2 text-[11px] text-[var(--color-error)]">
          {agentVarsError}
        </span>
      ) : null}
      <Button variant="secondary" size="sm" onClick={addRow}>
        Add mapping
      </Button>
    </div>
  );
}
