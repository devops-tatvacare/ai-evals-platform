import type { ReactNode } from 'react';
import { ScrollText, Search, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { LogSearchBar } from './LogSearchBar';

interface LogsPageShellProps {
  title: string;
  totalCount: number;
  filteredCount: number;
  groupCount?: number;
  isSearching: boolean;
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder?: string;
  emptyTitle: string;
  emptyDescription?: string;
  showExpandCollapseAll: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  headerActions?: ReactNode;
  isLive?: boolean;
  children: ReactNode;
}

export function LogsPageShell({
  title,
  totalCount,
  filteredCount,
  groupCount,
  isSearching,
  loading,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
  emptyTitle,
  emptyDescription,
  showExpandCollapseAll,
  onExpandAll,
  onCollapseAll,
  headerActions,
  isLive,
  children,
}: LogsPageShellProps) {
  return (
    <div className="flex-1 flex flex-col">
      {/* Sticky header: title + search */}
      <div className="sticky -top-6 z-10 bg-[var(--bg-primary)] -mt-6 pt-6 pb-4 space-y-4 border-b border-[var(--border-default)]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-[var(--text-primary)]">{title}</h1>
            <span className="text-xs text-[var(--text-muted)]">
              {filteredCount}{isSearching ? `/${totalCount}` : ''} entries
              {groupCount != null && groupCount > 1 && ` across ${groupCount} ${title === 'API Logs' ? 'runs' : 'evaluators'}`}
            </span>
            {isLive && (
              <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-info)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-info)] opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-info)]" />
                </span>
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showExpandCollapseAll && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={onExpandAll}
                  title="Expand all"
                  className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                >
                  <ChevronsUpDown className="h-4 w-4" />
                </button>
                <button
                  onClick={onCollapseAll}
                  title="Collapse all"
                  className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                >
                  <ChevronsDownUp className="h-4 w-4" />
                </button>
              </div>
            )}
            {headerActions}
          </div>
        </div>

        {/* Search */}
        {!loading && totalCount > 0 && (
          <LogSearchBar
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
          />
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : totalCount === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={ScrollText}
            title={emptyTitle}
            description={emptyDescription}
          />
        </div>
      ) : filteredCount === 0 && isSearching ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={Search}
            title="No matching logs"
            description={`No logs match "${searchQuery}".`}
          />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
