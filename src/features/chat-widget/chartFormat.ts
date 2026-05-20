import type { ChartTableColumn, KpiFormat } from './types';

const INTEGER_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DECIMAL_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const NUMBER_FMT = new Intl.NumberFormat('en-US');
const CURRENCY_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const ID_HASH_TRUNC_HEAD = 10;
const ID_HASH_TRUNC_TAIL = 20;
const ID_HASH_TRUNC_THRESHOLD = ID_HASH_TRUNC_HEAD + ID_HASH_TRUNC_TAIL + 2;

export function formatKpiValue(value: number | string | null, format: KpiFormat): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'integer':
      return INTEGER_FMT.format(value);
    case 'decimal':
      return DECIMAL_FMT.format(value);
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'currency':
      return CURRENCY_FMT.format(value);
    case 'duration_ms':
      return `${INTEGER_FMT.format(Math.round(value))} ms`;
    default:
      return String(value);
  }
}

export function formatSummaryValue(value: unknown, semanticType?: string | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (semanticType === 'percent') return `${value.toFixed(1)}%`;
    if (semanticType === 'currency') return CURRENCY_FMT.format(value);
    return NUMBER_FMT.format(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function truncateIdHash(value: string): string {
  if (value.length <= ID_HASH_TRUNC_THRESHOLD) return value;
  return `${value.slice(0, ID_HASH_TRUNC_HEAD)}…${value.slice(-ID_HASH_TRUNC_TAIL)}`;
}

export function isNumericColumn(column: ChartTableColumn): boolean {
  return column.role === 'measure' || column.semantic_type === 'count'
    || column.semantic_type === 'percent' || column.semantic_type === 'currency';
}

export function formatTableCell(value: unknown, column: ChartTableColumn): string {
  if (value === null || value === undefined) return '—';
  if (column.semantic_type === 'id_hash' && typeof value === 'string') {
    return truncateIdHash(value);
  }
  if (typeof value === 'number') {
    if (column.semantic_type === 'percent') return `${value.toFixed(1)}%`;
    if (column.semantic_type === 'currency') return CURRENCY_FMT.format(value);
    return NUMBER_FMT.format(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
