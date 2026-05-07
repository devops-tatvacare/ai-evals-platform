import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type {
  PredicateAst,
  SplitBranch,
  SplitMode,
} from '@/features/orchestration/types';

import { PredicateBuilder } from './PredicateBuilder';

interface SplitConfig {
  mode?: SplitMode;
  field?: string;
  branches?: SplitBranch[];
  default_branch_id?: string;
  drop_unmatched?: boolean;
}

interface Props {
  value: SplitConfig;
  onChange(next: SplitConfig): void;
  /** Payload fields available for the ``by_field`` mode — fed by the
   *  upstream source's allowed payload columns. */
  fieldOptions?: string[];
}

const MODE_OPTIONS: { value: SplitMode; label: string; help: string }[] = [
  { value: 'by_field', label: 'By field value',     help: 'Match a payload field against per-branch values' },
  { value: 'by_rules', label: 'By rules (predicates)', help: 'First matching predicate wins' },
  { value: 'random',   label: 'Random allocation',  help: 'Weighted random pick across branches' },
];

let _branchIdCounter = 0;
function makeBranchId(label: string): string {
  const slug = label.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'branch';
  _branchIdCounter += 1;
  return `${slug}_${_branchIdCounter}`;
}

/**
 * Phase 11 (Commit 2) — `logic.split` editor.
 *
 * Branches carry stable ids (Phase 11 §6.3) — labels are display-only and
 * may change without breaking edge routing. Branch ids never appear in the
 * UI; the editor generates one when the operator adds a branch and threads
 * it through unchanged on save.
 */
export function SplitBranchEditor({ value, onChange, fieldOptions }: Props) {
  const mode: SplitMode = value.mode ?? 'by_field';
  const branches = useMemo(() => value.branches ?? [], [value.branches]);

  const setMode = (next: SplitMode) => {
    // Phase 14 / Phase D — branch shape normalisation lives in the Zod
    // `LogicSplitConfigSchema.transform()`. Writing only the new mode is
    // enough: the store's `updateNodeConfig` parses the result and prunes
    // mode-incompatible branch fields automatically. The previous
    // event-time `normalizeSplitConfigForMode` call duplicated work and
    // could miss configs mutated through other code paths.
    onChange({ ...value, mode: next });
  };

  const updateBranch = (idx: number, patch: Partial<SplitBranch>) => {
    onChange({
      ...value,
      branches: branches.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const removeBranch = (idx: number) => {
    const removed = branches[idx];
    const next = branches.filter((_, i) => i !== idx);
    onChange({
      ...value,
      branches: next,
      default_branch_id:
        value.default_branch_id === removed.id ? undefined : value.default_branch_id,
    });
  };
  const addBranch = () => {
    const label = `Branch ${branches.length + 1}`;
    const newBranch: SplitBranch = { id: makeBranchId(label), label };
    if (mode === 'by_field') newBranch.match = '';
    if (mode === 'by_rules') newBranch.predicate = { field: '', op: 'eq', value: '' };
    if (mode === 'random') newBranch.weight = 1;
    onChange({ ...value, branches: [...branches, newBranch] });
  };

  const defaultOptions = branches.map((b) => ({ value: b.id, label: b.label }));

  return (
    <div className="flex flex-col gap-3">
      <Field label="Mode">
        <Select
          value={mode}
          onChange={(next) => setMode(next as SplitMode)}
          options={MODE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {MODE_OPTIONS.find((o) => o.value === mode)?.help}
        </p>
      </Field>

      {mode === 'by_field' ? (
        <Field label="Split field">
          {fieldOptions && fieldOptions.length > 0 ? (
            <Combobox
              value={value.field ?? ''}
              onChange={(next) => onChange({ ...value, field: next })}
              options={fieldOptions.map((f) => ({ value: f, label: f }))}
              placeholder="payload field"
            />
          ) : (
            <Input
              value={value.field ?? ''}
              onChange={(e) => onChange({ ...value, field: e.target.value })}
              placeholder="payload field"
            />
          )}
        </Field>
      ) : null}

      <Field label="Branches">
        <div className="flex flex-col gap-2">
          {branches.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              No branches — click Add to create one.
            </p>
          ) : null}
          {branches.map((b, idx) => (
            <div
              key={b.id}
              className="rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2"
            >
              <div className="mb-2 flex items-center gap-2">
                <Input
                  className="flex-1"
                  value={b.label}
                  onChange={(e) => updateBranch(idx, { label: e.target.value })}
                  placeholder="branch label"
                />
                <button
                  type="button"
                  onClick={() => removeBranch(idx)}
                  className="text-[var(--text-muted)] hover:text-[var(--color-error)]"
                  aria-label={`Remove branch ${b.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {mode === 'by_field' ? (
                <Input
                  value={
                    typeof b.match === 'string'
                      ? b.match
                      : b.match === undefined
                        ? ''
                        : String(b.match)
                  }
                  onChange={(e) => updateBranch(idx, { match: e.target.value })}
                  placeholder="match value"
                />
              ) : null}
              {mode === 'by_rules' ? (
                <PredicateBuilder
                  value={b.predicate}
                  onChange={(next: PredicateAst) =>
                    updateBranch(idx, { predicate: next })
                  }
                  fieldOptions={fieldOptions}
                />
              ) : null}
              {mode === 'random' ? (
                <Input
                  type="number"
                  min={0}
                  value={b.weight ?? 1}
                  onChange={(e) =>
                    updateBranch(idx, { weight: Number(e.target.value) })
                  }
                  placeholder="weight"
                />
              ) : null}
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addBranch}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add branch
          </Button>
        </div>
      </Field>

      <Field label="Default branch (unmatched)">
        <Combobox
          value={value.default_branch_id ?? ''}
          onChange={(next) => onChange({ ...value, default_branch_id: next })}
          options={defaultOptions}
          placeholder="(none — drops unmatched recipients)"
        />
        <label className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={Boolean(value.drop_unmatched)}
            onChange={(e) =>
              onChange({ ...value, drop_unmatched: e.target.checked })
            }
          />
          Drop recipients that match no branch (instead of the default)
        </label>
      </Field>
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
