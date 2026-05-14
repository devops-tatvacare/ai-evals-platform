import { type ReactNode, useState, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Info } from 'lucide-react';
import { cn } from '@/utils';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { Tooltip } from './Tooltip';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  key: string;
  order: SortOrder;
}

export type ColumnTextBehavior = 'wrap' | 'nowrap' | 'truncate';

/**
 * Visual treatment for a cell's content.
 * - `default` — plain cell text.
 * - `prose` — renders the cell as an inset commentary block (left accent
 *   border, subtle surface, relaxed leading) so a long free-text column
 *   reads as analysis rather than a flat data value.
 */
export type ColumnCellVariant = 'default' | 'prose';

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  headerTooltip?: ReactNode;
  width?: string;
  render: (row: T) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
  /** Controls how inline cell content behaves during horizontal resize. */
  textBehavior?: ColumnTextBehavior;
  /** Visual treatment for the cell content. Defaults to `default`. */
  cellVariant?: ColumnCellVariant;
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

function getCellContentClassName(textBehavior: ColumnTextBehavior | undefined): string {
  switch (textBehavior) {
    case 'nowrap':
      return 'whitespace-nowrap';
    case 'truncate':
      return 'overflow-hidden text-ellipsis whitespace-nowrap';
    case 'wrap':
    default:
      return 'whitespace-normal break-words';
  }
}

function getCellVariantClassName(variant: ColumnCellVariant | undefined): string {
  switch (variant) {
    case 'prose':
      return 'rounded-md border-l-2 border-[var(--border-brand)] bg-[var(--bg-tertiary)] px-3 py-2 leading-relaxed text-[var(--text-secondary)]';
    case 'default':
    default:
      return '';
  }
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

  if (isEmpty) {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="w-full max-w-sm">
            <EmptyState
              icon={emptyIcon ?? Inbox}
              title={emptyTitle}
              description={emptyDescription}
            />
          </div>
        </div>
      </div>
    );
  }

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
                        'px-3 py-2 align-middle text-left text-[length:var(--text-table-header)] font-medium uppercase tracking-wide text-[var(--text-muted)]',
                        col.sortable &&
                          'cursor-pointer select-none hover:text-[var(--text-secondary)]',
                        col.width,
                        col.headerClassName,
                      )}
                      >
                        <span className="inline-flex min-w-max items-center gap-1 whitespace-nowrap">
                          <span className="shrink-0">{col.header}</span>
                          {col.headerTooltip ? (
                            <Tooltip content={col.headerTooltip} position="bottom" maxWidth={240}>
                              <Info className="h-3 w-3 shrink-0 cursor-default text-[var(--text-muted)]" />
                            </Tooltip>
                          ) : null}
                          {SortIcon && (
                            <SortIcon
                              className={cn(
                              'h-3 w-3 shrink-0',
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
          <td
            key={col.key}
            className={cn(
              'px-3 py-3 text-[length:var(--text-table-cell)] text-[var(--text-primary)]',
              col.width,
              col.cellClassName,
            )}
          >
            <div
              className={cn(
                'block min-w-0 w-full',
                getCellContentClassName(col.textBehavior),
                getCellVariantClassName(col.cellVariant),
              )}
            >
              {col.render(row)}
            </div>
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
