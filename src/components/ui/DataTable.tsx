import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/utils';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  pagination?: {
    page: number;
    totalPages: number;
    onPageChange: (p: number) => void;
  };
}

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }, (_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-[var(--border-subtle)]">
          {Array.from({ length: columns }, (_, colIdx) => (
            <td key={colIdx} className="px-3 py-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-tertiary)]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  loading = false,
  emptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  pagination,
}: DataTableProps<T>) {
  const isEmpty = !loading && data.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[10px] border border-[var(--border-default)]">
        <table className="w-full border-collapse" style={{ minWidth: '980px' }}>
          <thead>
            <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]',
                    col.width,
                    col.headerClassName,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows columns={columns.length} />}
            {!loading &&
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-[var(--border-subtle)]',
                    onRowClick && 'cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-3 py-3', col.width, col.cellClassName)}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            {isEmpty && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    icon={emptyIcon ?? Inbox}
                    title={emptyTitle}
                    description={emptyDescription}
                    compact
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
        />
      )}
    </div>
  );
}
