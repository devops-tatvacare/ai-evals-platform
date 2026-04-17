import { type ReactNode, useState, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react';
import { cn } from '@/utils';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  key: string;
  order: SortOrder;
}

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  sortable?: boolean;
}

export interface DataTablePagination {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  pageSize?: number;
  totalItems?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (n: number) => void;
  showCount?: boolean;
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
  pagination?: DataTablePagination;
  sortState?: SortState;
  onSortChange?: (next: SortState) => void;
  /** Minimum horizontal width for the table. Defaults to 980px. */
  minWidth?: string;
  /** When true (default), the table body scrolls within its container and the header sticks to the top. */
  stickyHeader?: boolean;
  className?: string;
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
  sortState,
  onSortChange,
  minWidth = '980px',
  stickyHeader = true,
  className,
}: DataTableProps<T>) {
  const isEmpty = !loading && data.length === 0;
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const isExpandable = !!renderExpandedRow;

  const handleRowClick = useCallback(
    (row: T) => {
      if (renderExpandedRow) {
        const key = keyExtractor(row);
        setExpandedKey((prev) => (prev === key ? null : key));
      } else if (onRowClick) {
        onRowClick(row);
      }
    },
    [renderExpandedRow, onRowClick, keyExtractor],
  );

  const handleHeaderClick = useCallback(
    (col: ColumnDef<T>) => {
      if (!col.sortable || !onSortChange) return;
      const nextOrder: SortOrder =
        sortState?.key === col.key && sortState.order === 'asc' ? 'desc' : 'asc';
      onSortChange({ key: col.key, order: nextOrder });
    },
    [sortState, onSortChange],
  );

  const isClickable = isExpandable || !!onRowClick;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[var(--border-default)]',
        )}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse" style={{ minWidth }}>
            <thead
              className={cn(
                stickyHeader && 'sticky top-0 z-[var(--z-sticky)]',
                'bg-[var(--bg-secondary)]',
              )}
            >
              <tr className="border-b border-[var(--border-default)]">
                {columns.map((col) => {
                  const isSorted = sortState?.key === col.key;
                  const SortIcon = !col.sortable
                    ? null
                    : !isSorted
                    ? ArrowUpDown
                    : sortState?.order === 'asc'
                    ? ArrowUp
                    : ArrowDown;
                  return (
                    <th
                      key={col.key}
                      onClick={col.sortable ? () => handleHeaderClick(col) : undefined}
                      className={cn(
                        'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]',
                        col.sortable &&
                          'cursor-pointer select-none hover:text-[var(--text-secondary)]',
                        col.width,
                        col.headerClassName,
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.header}
                        {SortIcon && (
                          <SortIcon
                            className={cn(
                              'h-3 w-3',
                              isSorted
                                ? 'text-[var(--text-secondary)]'
                                : 'text-[var(--text-muted)] opacity-60',
                            )}
                          />
                        )}
                      </span>
                    </th>
                  );
                })}
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
      </div>
      {pagination && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
          pageSize={pagination.pageSize}
          pageSizeOptions={pagination.pageSizeOptions}
          onPageSizeChange={pagination.onPageSizeChange}
          totalItems={pagination.totalItems}
          showCount={pagination.showCount}
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
          <td key={col.key} className={cn('px-3 py-3', col.width, col.cellClassName)}>
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
