import { ClipboardList, Loader2, type LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { isActive, type AnyRunStatus } from '@/utils/runLifecycle';

interface Props {
  status: AnyRunStatus;
  /** True when the unfiltered result set has at least one row. */
  hasAnyData: boolean;
  /** True when the filtered result set (current search/filter) has rows. */
  hasFilteredData: boolean;
  /** Copy for the "terminal + no data" branch. */
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Copy for the "active" processing loader. */
  processingTitle?: string;
  processingMessage?: string;
}

/**
 * Three-way render for the results body when the table has no rows to draw:
 *  - active run                ⇒ inline processing loader
 *  - terminal run, no data     ⇒ `EmptyState`
 *  - terminal run, data exists ⇒ "no matches" hint (search/filter trimmed it)
 *
 * Returns `null` when there *are* filtered rows — the caller renders the
 * table itself.
 */
export function RunResultsEmptyState({
  status,
  hasAnyData,
  hasFilteredData,
  emptyIcon = ClipboardList,
  emptyTitle = 'No results',
  emptyMessage = 'No evaluation results yet.',
  processingTitle = 'Evaluations are being processed...',
  processingMessage = 'Results will appear here as items complete.',
}: Props) {
  if (hasFilteredData) return null;

  if (isActive(status)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 border border-dashed border-[var(--border-default)] rounded-lg py-10 px-6">
        <Loader2 className="h-6 w-6 text-[var(--color-info)] animate-spin" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">{processingTitle}</p>
        <p className="text-sm text-[var(--text-secondary)]">{processingMessage}</p>
      </div>
    );
  }

  if (!hasAnyData) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyMessage} compact />;
  }

  return (
    <EmptyState
      icon={emptyIcon}
      title="No matches"
      description="Adjust filters to see results."
      compact
    />
  );
}
