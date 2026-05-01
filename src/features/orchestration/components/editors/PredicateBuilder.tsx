import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Input } from '@/components/ui/Input';
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

const OP_OPTIONS: { value: PredicateOp; label: string; needsValue: boolean }[] = [
  { value: 'eq',          label: '= equals',         needsValue: true },
  { value: 'ne',          label: '≠ not equals',     needsValue: true },
  { value: 'gt',          label: '> greater than',   needsValue: true },
  { value: 'gte',         label: '≥ greater or eq',  needsValue: true },
  { value: 'lt',          label: '< less than',      needsValue: true },
  { value: 'lte',         label: '≤ less or eq',     needsValue: true },
  { value: 'in',          label: 'in (list)',        needsValue: true },
  { value: 'not_in',      label: 'not in (list)',    needsValue: true },
  { value: 'is_null',     label: 'is null',          needsValue: false },
  { value: 'is_not_null', label: 'is not null',      needsValue: false },
];

type PredicateKind = 'leaf' | 'and' | 'or' | 'not';

function kindOf(p: PredicateAst | undefined): PredicateKind {
  if (!p) return 'leaf';
  if ('all' in p) return 'and';
  if ('any' in p) return 'or';
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
    else if (next === 'and') onChange({ all: [emptyLeaf()] } as AndPredicate);
    else if (next === 'or') onChange({ any: [emptyLeaf()] } as OrPredicate);
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
        <div className="flex flex-col gap-1 rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2">
          <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
            NOT (inner)
          </span>
          <PredicateBuilder
            value={(value as NotPredicate).not}
            onChange={(inner) => onChange({ not: inner } as NotPredicate)}
            fieldOptions={fieldOptions}
          />
        </div>
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
  const opMeta = OP_OPTIONS.find((o) => o.value === value.op);
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
          Field
        </span>
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
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
          Op
        </span>
        <Combobox
          size="sm"
          value={value.op}
          onChange={(next) =>
            onChange({ ...value, op: next as PredicateOp })
          }
          options={OP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
          Value
        </span>
        {opMeta?.needsValue ? (
          <Input
            value={
              value.value === undefined || value.value === null
                ? ''
                : Array.isArray(value.value)
                  ? value.value.join(',')
                  : String(value.value)
            }
            onChange={(e) => {
              const raw = e.target.value;
              if (value.op === 'in' || value.op === 'not_in') {
                onChange({
                  ...value,
                  value: raw
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                });
              } else {
                onChange({ ...value, value: raw });
              }
            }}
            placeholder={
              value.op === 'in' || value.op === 'not_in' ? 'a, b, c' : 'value'
            }
          />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">
            (no value needed)
          </span>
        )}
      </div>
    </div>
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
    () => (kind === 'and' ? (value as AndPredicate).all : (value as OrPredicate).any),
    [value, kind],
  );

  const setChildren = (next: PredicateAst[]) => {
    if (kind === 'and') onChange({ all: next } as AndPredicate);
    else onChange({ any: next } as OrPredicate);
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
      {children.map((child, idx) => (
        <div
          key={idx}
          className="rounded-[var(--radius-default)] bg-[var(--bg-tertiary)] p-2"
        >
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
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addChild}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add clause
      </Button>
    </div>
  );
}
