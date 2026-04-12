import { type ReactNode, useState, useCallback } from 'react';
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
  /** Render an expanded detail section below the row when clicked. Takes precedence over onRowClick. */
  renderExpandedRow?: (row: T) => ReactNode;
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
  renderExpandedRow,
  loading = false,
  emptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  pagination,
}: DataTableProps<T>) {
  const isEmpty = !loading && data.length === 0;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const isExpandable = !!renderExpandedRow;

  const handleRowClick = useCallback((row: T) => {
    if (renderExpandedRow) {
      const key = keyExtractor(row);
      setExpandedKey((prev) => (prev === key ? null : key));
    } else if (onRowClick) {
      onRowClick(row);
    }
  }, [renderExpandedRow, onRowClick, keyExtractor]);

  const isClickable = isExpandable || !!onRowClick;

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
              data.map((row) => {
                const key = keyExtractor(row);
                const isExpanded = isExpandable && expandedKey === key;
                return (
                  <ExpandableRow
                    key={key}
                    row={row}
                    columns={columns}
                    isExpanded={isExpanded}
                    isClickable={isClickable}
                    onClick={() => handleRowClick(row)}
                    renderExpanded={isExpanded ? renderExpandedRow : undefined}
                  />
                );
              })}
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

function ExpandableRow<T>({
  row,
  columns,
  isExpanded,
  isClickable,
  onClick,
  renderExpanded,
}: {
  row: T;
  columns: ColumnDef<T>[];
  isExpanded: boolean;
  isClickable: boolean;
  onClick: () => void;
  renderExpanded?: (row: T) => ReactNode;
}) {
  return (
    <>
      <tr
        onClick={isClickable ? onClick : undefined}
        className={cn(
          'border-b border-[var(--border-subtle)]',
          isClickable && 'cursor-pointer transition-colors hover:bg-[var(--bg-secondary)]',
          isExpanded && 'bg-[var(--bg-secondary)]',
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
      {isExpanded && renderExpanded && (
        <tr className="bg-[var(--bg-secondary)]">
          <td colSpan={columns.length} className="px-4 py-3">
            {renderExpanded(row)}
          </td>
        </tr>
      )}
    </>
  );
}
