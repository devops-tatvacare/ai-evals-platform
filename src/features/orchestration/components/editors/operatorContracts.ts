import type {
  CohortColumnType,
  PredicateOp,
} from '@/features/orchestration/types';

export type PredicateOperatorValueKind = 'none' | 'scalar' | 'list';
export type CohortFilterOp = Exclude<PredicateOp, 'exists' | 'missing'>;

interface PredicateOperatorOption {
  value: PredicateOp;
  label: string;
  valueKind: PredicateOperatorValueKind;
}

interface CohortOperatorOption {
  value: CohortFilterOp;
  label: string;
}

export const PREDICATE_OPERATOR_OPTIONS: PredicateOperatorOption[] = [
  { value: 'eq', label: '= equals', valueKind: 'scalar' },
  { value: 'neq', label: '≠ not equals', valueKind: 'scalar' },
  { value: 'gt', label: '> greater than', valueKind: 'scalar' },
  { value: 'gte', label: '≥ greater or eq', valueKind: 'scalar' },
  { value: 'lt', label: '< less than', valueKind: 'scalar' },
  { value: 'lte', label: '≤ less or eq', valueKind: 'scalar' },
  { value: 'in', label: 'in (list)', valueKind: 'list' },
  { value: 'not_in', label: 'not in (list)', valueKind: 'list' },
  { value: 'contains', label: 'contains', valueKind: 'scalar' },
  { value: 'exists', label: 'exists', valueKind: 'none' },
  { value: 'missing', label: 'missing', valueKind: 'none' },
];

const PREDICATE_OPERATOR_META: Record<PredicateOp, PredicateOperatorOption> =
  Object.fromEntries(
    PREDICATE_OPERATOR_OPTIONS.map((option) => [option.value, option]),
  ) as Record<PredicateOp, PredicateOperatorOption>;

export const COHORT_OPERATOR_OPTIONS_BY_TYPE: Record<
  CohortColumnType,
  CohortOperatorOption[]
> = {
  integer: [
    { value: 'gte', label: '>=' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '<=' },
    { value: 'lt', label: '<' },
    { value: 'in', label: 'in list' },
    { value: 'not_in', label: 'not in list' },
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
  ],
  number: [
    { value: 'gte', label: '>=' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '<=' },
    { value: 'lt', label: '<' },
    { value: 'in', label: 'in list' },
    { value: 'not_in', label: 'not in list' },
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
  ],
  boolean: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
  ],
  datetime: [
    { value: 'gte', label: 'on/after' },
    { value: 'gt', label: 'after' },
    { value: 'lte', label: 'on/before' },
    { value: 'lt', label: 'before' },
    { value: 'in', label: 'in list' },
    { value: 'not_in', label: 'not in list' },
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
  ],
  string: [
    { value: 'in', label: 'in list' },
    { value: 'not_in', label: 'not in list' },
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
    { value: 'contains', label: 'contains' },
  ],
};

export function defaultCohortOperator(type: CohortColumnType): CohortFilterOp {
  if (type === 'integer' || type === 'number' || type === 'datetime') {
    return 'gte';
  }
  return 'eq';
}

export function getPredicateOperatorValueKind(
  op: PredicateOp,
): PredicateOperatorValueKind {
  return PREDICATE_OPERATOR_META[op].valueKind;
}

export function predicateOperatorNeedsValue(op: PredicateOp): boolean {
  return getPredicateOperatorValueKind(op) !== 'none';
}

export function isListOperator(
  op: string,
): op is Extract<PredicateOp, 'in' | 'not_in'> {
  return op === 'in' || op === 'not_in';
}

export function parseStringListInputValue(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function formatStringListInputValue(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .join(', ');
}

export function normalizePredicateValueForOperator(
  value: unknown,
  op: PredicateOp,
): unknown {
  const valueKind = getPredicateOperatorValueKind(op);
  if (valueKind === 'none') {
    return undefined;
  }
  if (valueKind === 'list') {
    if (Array.isArray(value)) {
      return parseStringListInputValue(formatStringListInputValue(value));
    }
    if (value === null || value === undefined || value === '') {
      return [];
    }
    return parseStringListInputValue(String(value));
  }
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}
