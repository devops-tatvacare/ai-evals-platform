import { cn } from '@/utils/cn';
import type { ChartTableColumn } from '../types';

interface ChatTableCardProps {
  columns: ChartTableColumn[];
  data: Array<Record<string, unknown>>;
  title?: string;
  warning?: string | null;
}

const NUMBER_FMT = new Intl.NumberFormat('en-US');
const CURRENCY_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const ID_HASH_TRUNC_HEAD = 10;
const ID_HASH_TRUNC_TAIL = 20;
const ID_HASH_TRUNC_THRESHOLD = ID_HASH_TRUNC_HEAD + ID_HASH_TRUNC_TAIL + 2;

export function truncateIdHash(value: string): string {
  if (value.length <= ID_HASH_TRUNC_THRESHOLD) return value;
  return `${value.slice(0, ID_HASH_TRUNC_HEAD)}…${value.slice(-ID_HASH_TRUNC_TAIL)}`;
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

export function ChatTableCard({ columns, data, title, warning }: ChatTableCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3',
      )}
    >
      {title ? (
        <div className="mb-2 px-1 text-xs font-medium text-[var(--text-muted)]">{title}</div>
      ) : null}
      {warning ? (
        <div className="mb-2 rounded-sm border border-[var(--border-warning)] bg-[var(--surface-warning)] px-2 py-1 text-[11px] text-[var(--color-warning-dark)]">
          {warning}
        </div>
      ) : null}
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--bg-secondary)]">
            <tr className="border-b border-[var(--border-default)]">
              {columns.map((column) => (
                <th
                  key={column.name}
                  className="px-2 py-1.5 text-left font-medium text-[var(--text-muted)]"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-[var(--border-subtle)] last:border-0"
              >
                {columns.map((column) => {
                  const raw = row[column.name];
                  return (
                    <td
                      key={column.name}
                      title={typeof raw === 'string' ? raw : undefined}
                      className="px-2 py-1.5 tabular-nums text-[var(--text-primary)]"
                    >
                      {formatTableCell(raw, column)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
