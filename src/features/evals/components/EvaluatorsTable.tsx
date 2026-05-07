import { type ReactNode, useMemo, useState } from 'react';
import { MoreVertical, PlayCircle, RotateCcw, Square, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  RoleBadge,
  VisibilityBadge,
  FilterButton,
  FilterPanel,
  type FilterFieldConfig,
} from '@/components/ui';
import { DataTable, type ColumnDef, type SortState } from '@/components/ui/DataTable';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import { useAuthStore } from '@/stores/authStore';
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
  onRestoreDefaults?: () => void;
  onToggleHeader?: (evaluator: EvaluatorDefinition) => void;
  isRestoringDefaults?: boolean;
  title?: string;
  description?: string;
  headerActions?: ReactNode;
  emptyStateActions?: ReactNode;
  onOpen?: (evaluator: EvaluatorDefinition) => void;
  onUpgradeReview?: (evaluator: EvaluatorDefinition) => void;
  canCreate?: boolean;
  canEditOwned?: boolean;
  canDeleteOwned?: boolean;
  canShareOwned?: boolean;
  canManageSeededDefaults?: boolean;
  loading?: boolean;
  /**
   * When true, skips the internal title/description header row so the table can
   * be embedded inside an outer shell (e.g. PageSurface).
   */
  hideHeader?: boolean;
  /** Controlled search term (case-insensitive name contains). */
  searchQuery?: string;
  /** Controlled filter panel open state. When provided together with
   * {@link onFilterPanelOpenChange}, the table also skips rendering its own
   * filter trigger button so the outer shell can host it (e.g. PageSurface). */
  filterPanelOpen?: boolean;
  onFilterPanelOpenChange?: (open: boolean) => void;
}

const DEFAULT_PAGE_SIZE = 25;

const FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'visibility',
    label: 'Visibility',
    control: 'segmented',
    options: [
      { value: 'all', label: 'All' },
      { value: 'shared', label: 'Shared' },
      { value: 'private', label: 'Private' },
    ],
  },
];

function compareEvaluators(
  a: EvaluatorDefinition,
  b: EvaluatorDefinition,
  key: string,
): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'updatedAt':
      return a.updatedAt.getTime() - b.updatedAt.getTime();
    case 'visibility':
      if (a.visibility === b.visibility) return 0;
      return a.visibility === 'shared' ? -1 : 1;
    default:
      return 0;
  }
}

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
  onRestoreDefaults,
  onToggleHeader,
  isRestoringDefaults = false,
  title,
  description,
  headerActions,
  emptyStateActions,
  onOpen,
  onUpgradeReview,
  canCreate = true,
  canEditOwned = false,
  canDeleteOwned = false,
  canShareOwned = false,
  canManageSeededDefaults = false,
  loading = false,
  hideHeader = false,
  searchQuery,
  filterPanelOpen: filterPanelOpenProp,
  onFilterPanelOpenChange,
}: EvaluatorsTableProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [internalFilterPanelOpen, setInternalFilterPanelOpen] = useState(false);
  const isFilterControlled = filterPanelOpenProp !== undefined && onFilterPanelOpenChange !== undefined;
  const filterPanelOpen = isFilterControlled ? filterPanelOpenProp : internalFilterPanelOpen;
  const setFilterPanelOpen = isFilterControlled ? onFilterPanelOpenChange : setInternalFilterPanelOpen;
  const [sortState, setSortState] = useState<SortState>({ key: 'updatedAt', order: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const user = useAuthStore((state) => state.user);
  const showRunColumn = Boolean(onRun || onCancelRun || Object.keys(latestRunsByEvaluatorId).length > 0);

  const searched = useMemo(() => {
    const query = (searchQuery ?? '').trim().toLowerCase();
    if (!query) return evaluators;
    return evaluators.filter((evaluator) =>
      evaluator.name.toLowerCase().includes(query),
    );
  }, [evaluators, searchQuery]);

  const sorted = useMemo(() => {
    const arr = [...searched];
    arr.sort((a, b) => {
      const cmp = compareEvaluators(a, b, sortState.key);
      return sortState.order === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [searched, sortState]);

  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const activeFilterCount = filter === 'all' ? 0 : 1;

  const columns = useMemo((): ColumnDef<EvaluatorDefinition>[] => {
    const base: ColumnDef<EvaluatorDefinition>[] = [
      {
        key: 'name',
        header: 'Name',
        sortable: true,
        width: 'min-w-[260px]',
        render: (evaluator) => (
          <div>
            <div className="flex items-center gap-2">
              {onOpen ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(evaluator);
                  }}
                  className="font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--text-brand)]"
                >
                  {evaluator.name}
                </button>
              ) : (
                <p className="font-medium text-[var(--text-primary)]">{evaluator.name}</p>
              )}
              {evaluatorShowsInHeader(evaluator) ? <RoleBadge role="metric" /> : null}
            </div>
            <p className="mt-1 max-w-[360px] truncate text-[length:var(--text-table-header)] text-[var(--text-secondary)]">
              {evaluator.prompt}
            </p>
          </div>
        ),
      },
      {
        key: 'source',
        header: 'Source',
        width: 'w-[140px]',
        render: (evaluator) => (
          <div className="flex flex-wrap items-center gap-1">
            {evaluator.templateId ? (
              <>
                <Badge size="sm" variant="info">linked</Badge>
                {evaluator.templateUpgradeAvailable ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpgradeReview?.(evaluator);
                    }}
                    className="inline-flex"
                  >
                    <Badge size="sm" variant="warning">↑ upgrade</Badge>
                  </button>
                ) : null}
              </>
            ) : evaluator.isCanonicalSeededDefault ? (
              <Badge size="sm" variant="info">default</Badge>
            ) : (
              <Badge size="sm" variant="neutral">custom</Badge>
            )}
          </div>
        ),
      },
      {
        key: 'owner',
        header: 'Owner',
        width: 'w-[140px]',
        render: (evaluator) => (
          <span className="text-sm text-[var(--text-primary)]">
            {evaluator.ownerName || 'Unknown'}
          </span>
        ),
      },
      {
        key: 'visibility',
        header: 'Visibility',
        width: 'w-[110px]',
        sortable: true,
        render: (evaluator) => <VisibilityBadge visibility={evaluator.visibility ?? 'private'} />,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        width: 'w-[120px]',
        textBehavior: 'nowrap',
        sortable: true,
        render: (evaluator) => (
          <span className="text-sm text-[var(--text-secondary)]">
            {evaluator.updatedAt.toLocaleDateString()}
          </span>
        ),
      },
    ];

    if (showRunColumn) {
      base.push({
        key: 'run',
        header: 'Run',
        width: 'w-[120px]',
        render: (evaluator) => {
          const latestRun = latestRunsByEvaluatorId[evaluator.id];
          if (!latestRun) return <span className="text-sm text-[var(--text-muted)]">—</span>;
          return (
            <Badge size="sm" variant={runStatusVariant(latestRun.status)}>
              {latestRun.status === 'completed_with_errors' ? 'Partial' : latestRun.status}
            </Badge>
          );
        },
      });
    }

    base.push({
      key: 'actions',
      header: '',
      width: 'w-[160px]',
      render: (evaluator) => {
        const latestRun = latestRunsByEvaluatorId[evaluator.id];
        const isOwned = Boolean(user && evaluator.userId === user.id && evaluator.tenantId === user.tenantId);
        const isRunning = latestRun?.status === 'running';
        const isCanonicalSeededDefault = evaluator.isCanonicalSeededDefault === true;
        const canEditRow = isCanonicalSeededDefault
          ? canManageSeededDefaults && Boolean(onEdit)
          : isOwned && canEditOwned && Boolean(onEdit);
        const canDeleteRow = isCanonicalSeededDefault
          ? canManageSeededDefaults && Boolean(onDelete)
          : isOwned && canDeleteOwned && Boolean(onDelete);
        const canVisibilityRow = isCanonicalSeededDefault
          ? false
          : isOwned && canShareOwned && Boolean(onVisibilityChange);
        const canToggleHeaderRow = isCanonicalSeededDefault
          ? canManageSeededDefaults && Boolean(onToggleHeader)
          : isOwned && canEditOwned && Boolean(onToggleHeader);
        return (
          <div
            className="flex items-center justify-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
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
                {canEditRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit?.(evaluator);
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
                {canVisibilityRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      onVisibilityChange?.(evaluator);
                      setMenuOpenId(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                  >
                    {evaluator.visibility === 'shared' ? 'Make Private' : 'Share'}
                  </button>
                ) : null}
                {canToggleHeaderRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleHeader?.(evaluator);
                      setMenuOpenId(null);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]"
                  >
                    {evaluatorShowsInHeader(evaluator) ? 'Remove from Header' : 'Show in Header'}
                  </button>
                ) : null}
                {canDeleteRow ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete?.(evaluator);
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
        );
      },
    });

    return base;
  }, [
    menuOpenId,
    onOpen,
    onUpgradeReview,
    onEdit,
    onFork,
    onDelete,
    onVisibilityChange,
    onRun,
    onCancelRun,
    onToggleHeader,
    user,
    canEditOwned,
    canDeleteOwned,
    canShareOwned,
    canManageSeededDefaults,
    latestRunsByEvaluatorId,
    showRunColumn,
  ]);

  const emptyDescription = filter === 'shared'
    ? 'No shared evaluators are available yet.'
    : filter === 'private'
      ? 'You have not created any private evaluators yet.'
      : 'No evaluators are available yet.';

  const filterButton = (
    <FilterButton
      activeCount={activeFilterCount}
      onClick={() => setFilterPanelOpen(true)}
      iconOnly
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {!hideHeader && (
        <div className="flex flex-col gap-3 pb-4 border-b border-[var(--border-default)] md:flex-row md:items-start md:justify-between">
          {(title || description) && (
            <div>
              {title && <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>}
              {description && <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>}
            </div>
          )}
          {/* When title/description are omitted (e.g. inside a tabs view), the buttons
              stay right-aligned via ml-auto so the row reads as a toolbar. Secondary
              controls (Run All, Restore Defaults, Filters) use iconOnly so "Create
              Evaluator" stands out as the primary CTA. */}
          <div className="flex flex-wrap items-center gap-2 md:ml-auto">
            {headerActions}
            {onRestoreDefaults ? (
              <Button
                variant="secondary"
                icon={RotateCcw}
                iconOnly
                onClick={onRestoreDefaults}
                isLoading={isRestoringDefaults}
                aria-label="Restore defaults"
                title="Restore defaults"
              >
                Restore Defaults
              </Button>
            ) : null}
            {filterButton}
            {canCreate ? <Button onClick={onCreate}>Create Evaluator</Button> : null}
          </div>
        </div>
      )}

      {/* When the header is hidden (outer PageSurface owns the CTAs) we still need
          the filter affordance above the table — unless the filter trigger is
          being hosted externally (controlled filterPanelOpen). */}
      {hideHeader && !isFilterControlled && (
        <div className="flex items-center justify-end gap-2">{filterButton}</div>
      )}

      <DataTable
        loading={loading}
        columns={columns}
        data={paged}
        keyExtractor={(row) => row.id}
        renderExpandedRow={(evaluator) => (
          <EvaluatorExpandRow
            evaluator={evaluator}
            latestRun={latestRunsByEvaluatorId[evaluator.id]}
          />
        )}
        sortState={sortState}
        onSortChange={(next) => {
          setSortState(next);
          setPage(1);
        }}
        pagination={{
          page: safePage,
          totalPages,
          pageSize,
          totalItems,
          showCount: true,
          onPageChange: setPage,
          onPageSizeChange: (n) => {
            setPageSize(n);
            setPage(1);
          },
        }}
        emptyIcon={PlayCircle}
        emptyTitle="No evaluators"
        emptyDescription={emptyDescription}
      />

      {emptyStateActions && !loading && totalItems === 0 ? (
        <div className="flex justify-center">{emptyStateActions}</div>
      ) : null}

      <FilterPanel
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        fields={FILTER_FIELDS}
        values={{ visibility: filter }}
        onChange={(patch) => {
          if (typeof patch.visibility === 'string') {
            onFilterChange(patch.visibility as EvaluatorVisibilityFilter);
            setPage(1);
          }
        }}
        onClear={() => {
          onFilterChange('all');
          setPage(1);
        }}
      />
    </div>
  );
}
