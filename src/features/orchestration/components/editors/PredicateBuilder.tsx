import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
import {
  InspectorCard,
  InspectorEmptyState,
  InspectorField,
} from '@/features/orchestration/components/inspector/InspectorPrimitives';
import {
  formatStringListInputValue,
  isListOperator,
  parseStringListInputValue,
  PREDICATE_OPERATOR_OPTIONS,
  predicateOperatorNeedsValue,
} from '@/features/orchestration/components/editors/operatorContracts';
import type {
  AndPredicate,
  LeafPredicate,
  NotPredicate,
  OrPredicate,
  PredicateAst,
  PredicateOp,
} from '@/features/orchestration/types';
import { cn } from '@/utils';

interface Props {
  value: PredicateAst | undefined;
  onChange(next: PredicateAst): void;
  /** Optional list of payload field names — surfaces a Combobox suggestion
   *  source. When omitted the field input is plain text. */
  fieldOptions?: string[];
}

type PredicateKind = 'leaf' | 'and' | 'or' | 'not';

function kindOf(p: PredicateAst | undefined): PredicateKind {
  if (!p) return 'leaf';
  if ('and' in p) return 'and';
  if ('or' in p) return 'or';
  if ('not' in p) return 'not';
  return 'leaf';
}

function emptyLeaf(): LeafPredicate {
  return { field: '', op: 'eq', value: '' };
}

/**
 * Phase 11 (Commit 2) — predicate builder used by `filter.eligibility`,
 * `logic.conditional`, and the event-match slot of `logic.wait`.
 *
 * Renders the recursive AST defined in
 * ``backend/app/services/orchestration/predicate_contract.py``. Authors
 * never edit raw JSON; the editor enforces shape (op needs value, AND/OR
 * have ≥1 child, NOT has exactly one child).
 */
export function PredicateBuilder({ value, onChange, fieldOptions }: Props) {
  const kind = kindOf(value);
  const leaf = kind === 'leaf' ? (value as LeafPredicate | undefined) ?? emptyLeaf() : null;

  const setKind = (next: PredicateKind) => {
    if (next === kind) return;
    if (next === 'leaf') onChange(emptyLeaf());
    else if (next === 'and') onChange({ and: [emptyLeaf()] } as AndPredicate);
    else if (next === 'or') onChange({ or: [emptyLeaf()] } as OrPredicate);
    else if (next === 'not') onChange({ not: emptyLeaf() } as NotPredicate);
  };

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-default)] border border-[var(--border-default)] p-2">
      <KindSwitcher kind={kind} onChange={setKind} />
      {kind === 'leaf' && leaf ? (
        <LeafEditor
          value={leaf}
          onChange={(next) => onChange(next)}
          fieldOptions={fieldOptions}
        />
      ) : null}
      {kind === 'and' || kind === 'or' ? (
        <CompoundEditor
          value={value as AndPredicate | OrPredicate}
          kind={kind}
          onChange={onChange}
          fieldOptions={fieldOptions}
        />
      ) : null}
      {kind === 'not' ? (
        <InspectorCard>
          <InspectorField label="NOT (inner)" className="gap-2">
            <PredicateBuilder
              value={(value as NotPredicate).not}
              onChange={(inner) => onChange({ not: inner } as NotPredicate)}
              fieldOptions={fieldOptions}
            />
          </InspectorField>
        </InspectorCard>
      ) : null}
    </div>
  );
}

function KindSwitcher({
  kind,
  onChange,
}: {
  kind: PredicateKind;
  onChange(next: PredicateKind): void;
}) {
  const tabs: { value: PredicateKind; label: string }[] = [
    { value: 'leaf', label: 'Leaf' },
    { value: 'and', label: 'AND' },
    { value: 'or', label: 'OR' },
    { value: 'not', label: 'NOT' },
  ];
  return (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'rounded-[var(--radius-default)] border px-2 py-0.5 text-xs',
            kind === t.value
              ? 'border-[var(--color-brand)] bg-[var(--bg-brand-soft)] text-[var(--text-brand)]'
              : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LeafEditor({
  value,
  onChange,
  fieldOptions,
}: {
  value: LeafPredicate;
  onChange(next: LeafPredicate): void;
  fieldOptions?: string[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <InspectorField label="Field" className="gap-1">
        {fieldOptions && fieldOptions.length > 0 ? (
          <Combobox
            size="sm"
            value={value.field}
            onChange={(next) => onChange({ ...value, field: next })}
            options={fieldOptions.map((f) => ({ value: f, label: f }))}
            placeholder="payload field"
          />
        ) : (
          <Input
            value={value.field}
            onChange={(e) => onChange({ ...value, field: e.target.value })}
            placeholder="payload field"
          />
        )}
      </InspectorField>
      <InspectorField label="Op" className="gap-1">
        <Combobox
          size="sm"
          value={value.op}
          onChange={(next) => {
            // Phase 14 / Phase D — value normalisation moved to the parse
            // boundary. The Zod leaf-predicate `.transform` runs
            // `normalizePredicateValueForOperator` whenever the parent
            // node config is parsed (every `updateNodeConfig`), so writing
            // the raw value here is enough — the store canonicalises it.
            onChange({ ...value, op: next as PredicateOp });
          }}
          options={PREDICATE_OPERATOR_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </InspectorField>
      <InspectorField label="Value" className="gap-1">
        {predicateOperatorNeedsValue(value.op) ? (
          isListOperator(value.op) ? (
            <ListPredicateValueInput
              value={value.value}
              onChange={(nextValue) => onChange({ ...value, value: nextValue })}
            />
          ) : (
            <Input
              value={
                value.value === undefined || value.value === null
                  ? ''
                  : Array.isArray(value.value)
                    ? String(value.value[0] ?? '')
                    : String(value.value)
              }
              onChange={(e) => {
                onChange({ ...value, value: e.target.value });
              }}
              placeholder="value"
            />
          )
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            (no value needed)
          </span>
        )}
      </InspectorField>
    </div>
  );
}

function ListPredicateValueInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange(next: string[]): void;
}) {
  const initialValue = formatStringListInputValue(value);

  return (
    <Input
      key={initialValue}
      type="text"
      defaultValue={initialValue}
      onChange={(e) => {
        onChange(parseStringListInputValue(e.target.value));
      }}
      placeholder="a, b, c"
    />
  );
}

function CompoundEditor({
  value,
  kind,
  onChange,
  fieldOptions,
}: {
  value: AndPredicate | OrPredicate;
  kind: 'and' | 'or';
  onChange(next: PredicateAst): void;
  fieldOptions?: string[];
}) {
  const children = useMemo<PredicateAst[]>(
    () => (kind === 'and' ? (value as AndPredicate).and : (value as OrPredicate).or),
    [value, kind],
  );

  const setChildren = (next: PredicateAst[]) => {
    if (kind === 'and') onChange({ and: next } as AndPredicate);
    else onChange({ or: next } as OrPredicate);
  };

  const updateChild = (idx: number, next: PredicateAst) => {
    setChildren(children.map((c, i) => (i === idx ? next : c)));
  };
  const removeChild = (idx: number) => {
    setChildren(children.filter((_, i) => i !== idx));
  };
  const addChild = () => {
    setChildren([...children, emptyLeaf()]);
  };

  return (
    <div className="flex flex-col gap-2">
      {children.length === 0 ? (
        <InspectorEmptyState>No clauses yet — click Add clause.</InspectorEmptyState>
      ) : null}
      {children.map((child, idx) => (
        <InspectorCard key={idx}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
              {kind === 'and' ? `Clause ${idx + 1} (AND)` : `Clause ${idx + 1} (OR)`}
            </span>
            <button
              type="button"
              onClick={() => removeChild(idx)}
              className="text-[var(--text-muted)] hover:text-[var(--color-error)]"
              aria-label={`Remove clause ${idx + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <PredicateBuilder
            value={child}
            onChange={(next) => updateChild(idx, next)}
            fieldOptions={fieldOptions}
          />
        </InspectorCard>
      ))}
      <Button variant="secondary" size="sm" onClick={addChild}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add clause
      </Button>
    </div>
  );
}
