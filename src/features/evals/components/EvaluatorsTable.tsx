import { type ReactNode, Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MoreVertical, PlayCircle, Square, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, RoleBadge, VisibilityBadge } from '@/components/ui';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';
import { evaluatorShowsInHeader } from '@/features/evals/utils/evaluatorMetadata';
import { EvaluatorExpandRow } from './EvaluatorExpandRow';
import type { BadgeVariant } from '@/components/ui/Badge';
import type { EvalRun, EvaluatorDefinition, EvaluatorVisibilityFilter } from '@/types';

const STATUS_BADGE_MAP: Record<string, BadgeVariant> = {
  completed: 'success',
  running: 'info',
  pending: 'neutral',
  failed: 'error',
  cancelled: 'warning',
  completed_with_errors: 'warning',
};

function runStatusVariant(status: string): BadgeVariant {
  return STATUS_BADGE_MAP[status] ?? 'neutral';
}

interface EvaluatorsTableProps {
  evaluators: EvaluatorDefinition[];
  latestRunsByEvaluatorId?: Record<string, EvalRun | undefined>;
  filter: EvaluatorVisibilityFilter;
  onFilterChange: (filter: EvaluatorVisibilityFilter) => void;
  onCreate: () => void;
  onEdit?: (evaluator: EvaluatorDefinition) => void;
  onFork?: (evaluator: EvaluatorDefinition) => void;
  onDelete?: (evaluator: EvaluatorDefinition) => void;
  onVisibilityChange?: (evaluator: EvaluatorDefinition) => void;
  onRun?: (evaluator: EvaluatorDefinition) => void;
  onCancelRun?: (evaluatorId: string) => void;
  onSeedDefaults?: () => void;
  onToggleHeader?: (evaluator: EvaluatorDefinition) => void;
  isSeeding?: boolean;
  title?: string;
  description?: string;
  headerActions?: ReactNode;
  emptyStateActions?: ReactNode;
  onOpen?: (evaluator: EvaluatorDefinition) => void;
  canCreate?: boolean;
}

const FILTER_OPTIONS: EvaluatorVisibilityFilter[] = ['all', 'shared', 'private'];

export function EvaluatorsTable({
  evaluators,
  latestRunsByEvaluatorId = {},
  filter,
  onFilterChange,
  onCreate,
  onEdit,
  onFork,
  onDelete,
  onVisibilityChange,
  onRun,
  onCancelRun,
  onSeedDefaults,
  onToggleHeader,
  isSeeding = false,
  title = 'Evaluators',
  description = 'Manage shared and private evaluators in one place.',
  headerActions,
  emptyStateActions,
  onOpen,
  canCreate = true,
}: EvaluatorsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const user = useAuthStore((state) => state.user);
  const showRunColumn = Boolean(onRun || onCancelRun || Object.keys(latestRunsByEvaluatorId).length > 0);

  const sortedEvaluators = useMemo(() => {
    return [...evaluators].sort((left, right) => {
      if (left.visibility !== right.visibility) {
        return left.visibility === 'shared' ? -1 : 1;
      }
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
  }, [evaluators]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const emptyDescription = filter === 'shared'
    ? 'No shared evaluators are available yet.'
    : filter === 'private'
      ? 'You have not created any private evaluators yet.'
      : 'No evaluators are available yet.';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {onSeedDefaults ? (
            <Button variant="secondary" onClick={onSeedDefaults} isLoading={isSeeding}>
              Seed Defaults
            </Button>
          ) : null}
          {canCreate ? <Button onClick={onCreate}>Create Evaluator</Button> : null}
        </div>
      </div>

      <div className="inline-flex rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onFilterChange(option)}
            className={cn(
              'rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition-colors',
              filter === option
                ? 'bg-[var(--interactive-primary)] text-[var(--text-on-color)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {option === 'all' ? 'All' : option === 'shared' ? 'Shared' : 'Private'}
          </button>
        ))}
      </div>

      {sortedEvaluators.length === 0 ? (
        <div className="flex min-h-[calc(100vh-280px)] items-center justify-center">
          <EmptyState
            icon={PlayCircle}
            title="No evaluators"
            description={emptyDescription}
          >
            <div className="flex flex-wrap items-center justify-center gap-2">
              {emptyStateActions}
              {canCreate ? <Button size="sm" onClick={onCreate}>Create Evaluator</Button> : null}
            </div>
          </EmptyState>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-[var(--border-default)]">
          <table className="w-full min-w-[980px] border-collapse">
            <thead className="bg-[var(--bg-secondary)]">
              <tr className="border-b border-[var(--border-default)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="w-12 px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Visibility</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                {showRunColumn ? <th className="px-3 py-2 font-medium">Run</th> : null}
                <th className="w-24 px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEvaluators.map((evaluator) => {
                const latestRun = latestRunsByEvaluatorId[evaluator.id];
                const isExpanded = expandedIds.has(evaluator.id);
                const isOwned = Boolean(user && evaluator.userId === user.id && evaluator.tenantId === user.tenantId);
                const isRunning = latestRun?.status === 'running';

                return (
                  <Fragment key={evaluator.id}>
                    <tr className="border-b border-[var(--border-subtle)] align-top">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(evaluator.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)]"
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            {onOpen ? (
                              <button
                                type="button"
                                onClick={() => onOpen(evaluator)}
                                className="font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--text-brand)]"
                              >
                                {evaluator.name}
                              </button>
                            ) : (
                              <p className="font-medium text-[var(--text-primary)]">{evaluator.name}</p>
                            )}
                            {evaluatorShowsInHeader(evaluator) ? <RoleBadge role="metric" /> : null}
                          </div>
                          <p className="mt-1 max-w-[360px] truncate text-xs text-[var(--text-secondary)]">
                            {evaluator.prompt}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-[var(--text-primary)]">
                        {evaluator.ownerName || 'Unknown'}
                      </td>
                      <td className="px-3 py-3">
                        <VisibilityBadge visibility={evaluator.visibility ?? 'private'} />
                      </td>
                      <td className="px-3 py-3 text-sm text-[var(--text-secondary)]">
                        {evaluator.updatedAt.toLocaleDateString()}
                      </td>
                      {showRunColumn ? (
                        <td className="px-3 py-3">
                          {latestRun ? (
                            <Badge size="sm" variant={runStatusVariant(latestRun.status)}>
                              {latestRun.status === 'completed_with_errors' ? 'Partial' : latestRun.status}
                            </Badge>
                          ) : (
                            <span className="text-sm text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {onRun ? (
                            isRunning ? (
                              <Button variant="secondary" size="sm" onClick={() => onCancelRun?.(evaluator.id)} icon={Square}>
                                Stop
                              </Button>
                            ) : (
                              <Button variant="secondary" size="sm" onClick={() => onRun(evaluator)} icon={PlayCircle}>
                                Run
                              </Button>
                            )
                          ) : null}
                          <Popover
                            open={menuOpenId === evaluator.id}
                            onOpenChange={(open) => setMenuOpenId(open ? evaluator.id : null)}
                          >
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="sm" icon={MoreVertical} />
                            </PopoverTrigger>
                            <PopoverContent
                              align="end"
                              side="bottom"
                              className="w-fit min-w-[140px] rounded-[8px] bg-[var(--bg-elevated)] py-1"
                            >
                              {isOwned && onEdit ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onEdit(evaluator);
                                    setMenuOpenId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                                >
                                  Edit
                                </button>
                              ) : null}
                              {onFork ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onFork(evaluator);
                                    setMenuOpenId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                                >
                                  Fork
                                </button>
                              ) : null}
                              {onVisibilityChange && isOwned ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onVisibilityChange(evaluator);
                                    setMenuOpenId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                                >
                                  {evaluator.visibility === 'shared' ? 'Make Private' : 'Share'}
                                </button>
                              ) : null}
                              {onToggleHeader && isOwned ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onToggleHeader(evaluator);
                                    setMenuOpenId(null);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                                >
                                  {evaluatorShowsInHeader(evaluator) ? 'Remove from Header' : 'Show in Header'}
                                </button>
                              ) : null}
                              {isOwned && onDelete ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDelete(evaluator);
                                    setMenuOpenId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-error)] hover:bg-[var(--interactive-secondary)]"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </button>
                              ) : null}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-b border-[var(--border-subtle)]">
                        <td colSpan={showRunColumn ? 7 : 6} className="px-3 py-3">
                          <EvaluatorExpandRow
                            evaluator={evaluator}
                            latestRun={latestRun}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
