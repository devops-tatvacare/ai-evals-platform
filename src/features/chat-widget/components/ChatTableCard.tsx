import { cn } from '@/utils/cn';
import { formatTableCell, isNumericColumn } from '../chartFormat';
import type { ChartTableColumn } from '../types';

interface ChatTableCardProps {
  columns: ChartTableColumn[];
  data: Array<Record<string, unknown>>;
}

// Body-only: sticky tinted header, zebra rows, row hover, numerics right-aligned.
export function ChatTableCard({ columns, data }: ChatTableCardProps) {
  return (
    <div className="-mx-1 max-h-64 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-[var(--z-base)] bg-[var(--bg-tertiary)]">
          <tr>
            {columns.map((column) => (
              <th
                key={column.name}
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]',
                  isNumericColumn(column) ? 'text-right' : 'text-left',
                )}
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
              className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-brand-subtle)]"
            >
              {columns.map((column) => {
                const raw = row[column.name];
                return (
                  <td
                    key={column.name}
                    title={typeof raw === 'string' ? raw : undefined}
                    className={cn(
                      'px-2.5 py-1.5 tabular-nums text-[var(--text-primary)]',
                      isNumericColumn(column) ? 'text-right' : 'text-left',
                    )}
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
  );
}
