import { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, Clock, AlertTriangle, Search } from 'lucide-react';
import { Button, Skeleton, EmptyState } from '@/components/ui';
import { cn, formatDate } from '@/utils';
import { fetchEvalRuns } from '@/services/api/evalRunsApi';
import type { EvalRun } from '@/types';

interface EvaluatorHistoryListOverlayProps {
  isOpen: boolean;
  evaluatorId: string;
  evaluatorName: string;
  listingId: string;
  onClose: () => void;
  onSelectRun: (run: EvalRun) => void;
}

type StatusFilter = 'all' | 'completed' | 'failed' | 'running' | 'pending';

export function EvaluatorHistoryListOverlay({
  isOpen,
  evaluatorId,
  evaluatorName,
  listingId,
  onClose,
  onSelectRun,
}: EvaluatorHistoryListOverlayProps) {
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadRuns();
    }
  }, [isOpen, evaluatorId, listingId, statusFilter, page]);

  // Trigger slide-in animation after mount
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose();
      }
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'unset';
      };
    }
  }, [isOpen, onClose]);

  const loadRuns = async () => {
    setLoading(true);
    try {
      const result = await fetchEvalRuns({
        evaluator_id: evaluatorId,
        listing_id: listingId || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 20,
        offset: (page - 1) * 20,
      });

      if (page === 1) {
        setRuns(result);
      } else {
        setRuns(prev => [...prev, ...result]);
      }

      setHasMore(result.length === 20);
      setTotalCount(result.length + (page - 1) * 20);
    } catch (error) {
      console.error('Failed to load evaluator history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setPage(1);
    setRuns([]);
  };

  const handleLoadMore = () => {
    setPage(prev => prev + 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          "ml-auto relative z-10 h-full w-[800px] bg-[var(--bg-elevated)] shadow-2xl overflow-hidden",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Evaluator History
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {evaluatorName} {totalCount > 0 && `• ${totalCount} run${totalCount !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters */}
        <div className="shrink-0 px-6 py-3 border-b border-[var(--border-subtle)] space-y-3 bg-[var(--bg-secondary)]">
          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] font-medium">Status:</span>
              <div className="flex gap-1">
                <FilterButton
                  active={statusFilter === 'all'}
                  onClick={() => handleFilterChange('all')}
                >
                  All
                </FilterButton>
                <FilterButton
                  active={statusFilter === 'completed'}
                  onClick={() => handleFilterChange('completed')}
                  icon={<CheckCircle2 className="h-3 w-3" />}
                >
                  Completed
                </FilterButton>
                <FilterButton
                  active={statusFilter === 'failed'}
                  onClick={() => handleFilterChange('failed')}
                  icon={<XCircle className="h-3 w-3" />}
                >
                  Failed
                </FilterButton>
                <FilterButton
                  active={statusFilter === 'running'}
                  onClick={() => handleFilterChange('running')}
                  icon={<Clock className="h-3 w-3" />}
                >
                  Running
                </FilterButton>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && page === 1 ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={statusFilter !== 'all' ? Search : Clock}
              title={statusFilter !== 'all'
                ? 'No runs match the selected filters'
                : 'No runs found'}
              description={statusFilter !== 'all'
                ? 'Try changing the filters to see more results.'
                : undefined}
            />
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <HistoryRunItem
                  key={run.id}
                  run={run}
                  onClick={() => onSelectRun(run)}
                />
              ))}

              {hasMore && (
                <div className="pt-3 flex justify-center">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleLoadMore}
                    disabled={loading}
                  >
                    {loading ? 'Loading...' : 'Load More'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, icon, children }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-1 text-xs rounded-md transition-colors flex items-center gap-1",
        active
          ? "bg-[var(--color-info)]/20 text-[var(--text-brand)] font-medium"
          : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)]"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

interface HistoryRunItemProps {
  run: EvalRun;
  onClick: () => void;
}

function HistoryRunItem({ run, onClick }: HistoryRunItemProps) {
  const statusIcon: Record<string, React.ReactNode> = {
    completed: <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />,
    failed: <XCircle className="h-4 w-4 text-[var(--color-error)]" />,
    running: <Clock className="h-4 w-4 text-[var(--color-info)] animate-pulse" />,
    pending: <Clock className="h-4 w-4 text-[var(--color-info)] animate-pulse" />,
    cancelled: <XCircle className="h-4 w-4 text-[var(--text-muted)]" />,
    completed_with_errors: <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />,
  };

  const durationSec = run.durationMs ? (run.durationMs / 1000).toFixed(1) : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)] transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {statusIcon[run.status] ?? <Clock className="h-4 w-4 text-[var(--text-muted)]" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              {formatDate(new Date(run.createdAt))}
            </span>
            {durationSec && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {durationSec}s
              </span>
            )}
          </div>

          {run.status === 'failed' && run.errorMessage && (
            <div className="text-xs text-[var(--color-error)] mt-1 truncate">
              {run.errorMessage}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
