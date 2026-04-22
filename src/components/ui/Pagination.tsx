import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { Select } from './Select';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showCount?: boolean;
  totalItems?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  className?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function Pagination({
  page,
  totalPages,
  onPageChange,
  showCount = false,
  totalItems,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const hasSizeSelector = !!onPageSizeChange && pageSize != null;
  const hasCount = showCount && totalItems != null && pageSize != null;

  if (totalPages <= 1 && !hasSizeSelector && !hasCount) return null;

  const showNumberedPages = totalPages <= 10;
  const sizeOptions = pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / page` }));

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {showNumberedPages ? (
            Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={cn(
                  'min-w-[28px] h-7 px-1.5 text-xs font-medium rounded transition-colors',
                  page === p
                    ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                {p}
              </button>
            ))
          ) : (
            <span className="px-2 text-[12px] text-[var(--text-secondary)]">
              {page} / {totalPages}
            </span>
          )}

          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {hasSizeSelector && (
        <Select
          size="sm"
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange(Number(v))}
          options={sizeOptions}
          className="w-[110px]"
        />
      )}
      {hasCount && ((totalItems as number) > 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Showing {(page - 1) * (pageSize as number) + 1}&ndash;
          {Math.min(page * (pageSize as number), totalItems as number)} of {totalItems}
        </p>
      ) : (
        <p className="text-[12px] text-[var(--text-muted)]">No results</p>
      ))}
    </div>
  );
}
