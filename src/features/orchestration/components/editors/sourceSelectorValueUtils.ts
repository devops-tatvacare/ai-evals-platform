import type { CohortColumnType } from '@/features/orchestration/types';

export function parseListInputValue(raw: string, type: CohortColumnType): unknown[] {
  const rawItems = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (type === 'integer' || type === 'number') {
    return rawItems
      .map((entry) => Number(entry))
      .filter((entry) => !Number.isNaN(entry));
  }
  return rawItems;
}

export function formatListInputValue(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .join(', ');
}

export function normalizeFilterValueForOperator(
  value: unknown,
  type: CohortColumnType,
  op: string,
  defaultValue: (type: CohortColumnType) => unknown,
): unknown {
  if (op === 'in' || op === 'not_in') {
    if (Array.isArray(value)) {
      return parseListInputValue(formatListInputValue(value), type);
    }
    if (value === null || value === undefined || value === '') {
      return [];
    }
    return parseListInputValue(String(value), type);
  }
  if (Array.isArray(value)) {
    return value[0] ?? defaultValue(type);
  }
  if (value === null || value === undefined) {
    return defaultValue(type);
  }
  if (type === 'integer' || type === 'number') {
    return typeof value === 'number' ? value : Number(value);
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 'false' ? false : Boolean(value);
  }
  return String(value);
}
