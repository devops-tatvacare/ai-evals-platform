import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { getAgentVariables } from '@/services/api/orchestrationConnections';
import { cn } from '@/utils';

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
   *  GET /connections/{id}/agent-variables (with the optional agent_id
   *  query). When unset, the row falls back to a free-text input — used
   *  during initial setup before a connection has been picked. */
  connectionId?: string;
  agentId?: string;
  templateSlug?: string;
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
  templateSlug,
}: Props) {
  const rows = useMemo(() => asVariableMappings(value), [value]);

  const [agentVars, setAgentVars] = useState<string[] | null>(null);
  const [agentVarsError, setAgentVarsError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId) {
      setAgentVars(null);
      setAgentVarsError(null);
      return;
    }
    let alive = true;
    setAgentVarsError(null);
    getAgentVariables(connectionId, { agentId, templateSlug })
      .then((res) => {
        if (!alive) return;
        setAgentVars(res.variables);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setAgentVars([]);
        setAgentVarsError(
          err instanceof Error ? err.message : 'Failed to load agent variables',
        );
      });
    return () => {
      alive = false;
    };
  }, [connectionId, agentId, templateSlug]);

  const updateRow = (idx: number, patch: Partial<VariableMapping>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
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
    <div className="flex flex-col gap-2 rounded-[var(--radius-default)] border border-[var(--border-default)] p-2">
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-[var(--text-secondary)]">
          No variable mappings — click Add to bind an agent variable.
        </p>
      ) : null}
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2"
        >
          <div className="grid flex-1 grid-cols-3 gap-2">
            <div className={cn('flex flex-col gap-0.5')}>
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                Variable
              </span>
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
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                Source
              </span>
              <Combobox
                size="sm"
                value={row.source_kind}
                onChange={(next) =>
                  updateRow(idx, {
                    source_kind:
                      next === 'static' ? 'static' : 'payload',
                  })
                }
                options={SOURCE_OPTIONS}
                placeholder="Source"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                {row.source_kind === 'payload' ? 'Field' : 'Value'}
              </span>
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
            </div>
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
      ))}
      <div className="flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={addRow}>
          Add mapping
        </Button>
        {agentVarsError ? (
          <span className="text-[11px] text-[var(--color-error)]">{agentVarsError}</span>
        ) : null}
      </div>
    </div>
  );
}
