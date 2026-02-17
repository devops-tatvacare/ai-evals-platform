import { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, Clock, AlertTriangle, Calendar, Search } from 'lucide-react';
import { Button, Skeleton, EmptyState } from '@/components/ui';
import { cn, formatDate } from '@/utils';
import { historyRepository } from '@/services/storage';
import type { EvaluatorRunHistory, HistoryStatus } from '@/types';

interface EvaluatorHistoryListOverlayProps {
  isOpen: boolean;
  evaluatorId: string;
  evaluatorName: string;
  listingId: string;
  onClose: () => void;
  onSelectRun: (run: EvaluatorRunHistory) => void;
}

type StatusFilter = 'all' | HistoryStatus;

export function EvaluatorHistoryListOverlay({
  isOpen,
  evaluatorId,
  evaluatorName,
  listingId,
  onClose,
  onSelectRun,
}: EvaluatorHistoryListOverlayProps) {
  const [runs, setRuns] = useState<EvaluatorRunHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<'7d' | '30d' | 'all'>('30d');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadRuns();
    }
  }, [isOpen, evaluatorId, listingId, statusFilter, dateFilter, page]);

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
      const now = Date.now();
      const startDate = dateFilter === '7d' 
        ? new Date(now - 7 * 24 * 60 * 60 * 1000)
        : dateFilter === '30d'
        ? new Date(now - 30 * 24 * 60 * 60 * 1000)
        : undefined;

      const result = await historyRepository.getEvaluatorRunsForListing(
        listingId,
        evaluatorId,
        {
          page,
          pageSize: 20,
          status: statusFilter === 'all' ? undefined : statusFilter,
          startDate,
          sortDesc: true,
        }
      );

      if (page === 1) {
        setRuns(result.entries);
      } else {
        setRuns(prev => [...prev, ...result.entries]);
      }
      
      setHasMore(result.hasMore);
      setTotalCount(result.totalCount);
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

  const handleDateFilterChange = (filter: '7d' | '30d' | 'all') => {
    setDateFilter(filter);
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
                  active={statusFilter === 'success'}
                  onClick={() => handleFilterChange('success')}
                  icon={<CheckCircle2 className="h-3 w-3" />}
                >
                  Success
                </FilterButton>
                <FilterButton
                  active={statusFilter === 'error'}
                  onClick={() => handleFilterChange('error')}
                  icon={<XCircle className="h-3 w-3" />}
                >
                  Error
                </FilterButton>
                <FilterButton
                  active={statusFilter === 'timeout'}
                  onClick={() => handleFilterChange('timeout')}
                  icon={<AlertTriangle className="h-3 w-3" />}
                >
                  Timeout
                </FilterButton>
            </div>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] font-medium">
              <Calendar className="h-3 w-3 inline mr-1" />
              Period:
            </span>
              <div className="flex gap-1">
                <FilterButton
                  active={dateFilter === '7d'}
                  onClick={() => handleDateFilterChange('7d')}
                >
                  Last 7 days
                </FilterButton>
                <FilterButton
                  active={dateFilter === '30d'}
                  onClick={() => handleDateFilterChange('30d')}
                >
                  Last 30 days
                </FilterButton>
                <FilterButton
                  active={dateFilter === 'all'}
                  onClick={() => handleDateFilterChange('all')}
                >
                  All time
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
              icon={statusFilter !== 'all' || dateFilter !== 'all' ? Search : Clock}
              title={statusFilter !== 'all' || dateFilter !== 'all'
                ? 'No runs match the selected filters'
                : 'No runs found'}
              description={statusFilter !== 'all' || dateFilter !== 'all'
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
  run: EvaluatorRunHistory;
  onClick: () => void;
}

function HistoryRunItem({ run, onClick }: HistoryRunItemProps) {
  const statusIcon = {
    success: <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />,
    error: <XCircle className="h-4 w-4 text-[var(--color-error)]" />,
    timeout: <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />,
    cancelled: <XCircle className="h-4 w-4 text-[var(--text-muted)]" />,
    pending: <Clock className="h-4 w-4 text-[var(--color-info)] animate-pulse" />,
  };

  const durationSec = run.durationMs ? (run.durationMs / 1000).toFixed(1) : null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)] transition-all group"
    >
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {statusIcon[run.status]}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-[var(--text-muted)]">
              {formatDate(new Date(run.timestamp))}
            </span>
            {durationSec && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {durationSec}s
              </span>
            )}
          </div>
          
          {run.status === 'error' && run.data.error_details && (
            <div className="text-xs text-[var(--color-error)] mt-1 truncate">
              {(run.data.error_details as { message?: string }).message || 'Error occurred'}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
