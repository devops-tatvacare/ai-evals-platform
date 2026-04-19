import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { EmptyState, Button } from '@/components/ui';
import type { Slice } from '@/stores/costStore';

interface SliceStateBoundaryProps<T> {
  slice: Slice<T> | (Slice<T> & { page: number });
  children: (data: T) => ReactNode;
  onRetry?: () => void;
  loadingLabel?: string;
  /** When provided and returns true for the ready `data`, render a centered
   *  empty state instead of the children. Keeps "no data" visuals consistent
   *  across tabs that don't use DataTable's built-in empty handler. */
  isEmpty?: (data: T) => boolean;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Full-height flex wrapper used for every non-content branch so that
 *  loading / error / empty visuals sit centered in the available viewport
 *  rather than pinned to the top of the tab panel. Parent tab wrappers
 *  use `h-full flex flex-col`; this child then stretches via flex-1. */
function CenteredFill({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      {children}
    </div>
  );
}

export function SliceStateBoundary<T>({
  slice,
  children,
  onRetry,
  loadingLabel = 'Loading…',
  isEmpty,
  emptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
}: SliceStateBoundaryProps<T>) {
  if (slice.status === 'idle' || slice.status === 'loading') {
    return (
      <CenteredFill>
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{loadingLabel}</span>
        </div>
      </CenteredFill>
    );
  }
  if (slice.status === 'error') {
    return (
      <CenteredFill>
        <div className="w-full max-w-sm">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load data"
            description={slice.error || 'Request failed'}
          >
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </EmptyState>
        </div>
      </CenteredFill>
    );
  }
  if (!slice.data) {
    return null;
  }
  if (isEmpty && isEmpty(slice.data)) {
    return (
      <CenteredFill>
        <div className="w-full max-w-sm">
          <EmptyState
            icon={emptyIcon ?? Inbox}
            title={emptyTitle}
            description={emptyDescription}
          />
        </div>
      </CenteredFill>
    );
  }
  return <>{children(slice.data)}</>;
}
