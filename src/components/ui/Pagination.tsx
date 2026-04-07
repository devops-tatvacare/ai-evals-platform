import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showCount?: boolean;
  totalItems?: number;
  pageSize?: number;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  showCount = false,
  totalItems,
  pageSize,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const showNumberedPages = totalPages <= 10;

  return (
    <div className={cn('flex items-center justify-between', className)}>
      {showCount && totalItems != null && pageSize != null ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Showing {(page - 1) * pageSize + 1}&ndash;{Math.min(page * pageSize, totalItems)} of{' '}
          {totalItems}
        </p>
      ) : (
        <div />
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
