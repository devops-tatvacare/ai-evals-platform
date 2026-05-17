import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCurrentAppId, usePoll, useTableQueryParams } from '@/hooks';
import { FlaskConical, Search } from 'lucide-react';
import type { EvalRun } from '@/types';
import { fetchEvalRunsPaged, deleteEvalRun } from '@/services/api/evalRunsApi';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { ConfirmDialog, FilterButton, FilterPanel, PageHeaderSearch } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { SortState } from '@/components/ui/DataTable';
import { PageSurface } from '@/components/ui/PageSurface';
import { isActive } from '@/utils/runLifecycle';
import { inferAppIdFromPath } from '@/config/routes';
import { usePageMetadata } from '@/config/pageMetadata';
import { useAppPageActions } from '@/features/pageActions/registry';
import { timeAgo } from '@/utils/evalFormatters';
import { useStableEvalRunUpdate } from '../hooks';
import { useJobTrackerStore } from '@/stores';
import { getRunsListConfig, buildRunsListRow, type RunsListRow } from '../runsListRegistry';
import type { RunType } from '../types';

function jobTypeToRunType(jobType: string): RunType {
  if (jobType.includes('adversarial')) return 'adversarial';
  if (jobType.includes('batch')) return 'batch';
  return 'custom';
}

export default function RunList() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentAppId = useCurrentAppId();
  const { icon, title } = usePageMetadata('runs');
  const pageActions = useAppPageActions('runs', { displayMode: 'icon' });

  const inferred = inferAppIdFromPath(location.pathname);
  const appId = inferred ?? currentAppId;
  const config = getRunsListConfig(appId);

  const filterKeys = useMemo(() => config.filterFields.map((f) => f.key), [config.filterFields]);

  const {
    state,
    setPage,
    setPageSize,
    setSort,
    setFilters,
    clearFilters,
    activeFilterCount,
  } = useTableQueryParams({
    defaultPageSize: 25,
    filterKeys,
    textFilterKeys: ['q'],
    defaultSort: { key: 'created_at', order: 'desc' },
  });

  const [items, setItems] = useState<EvalRun[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const isInitialLoad = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const stableSetItems = useStableEvalRunUpdate(setItems);

  const qValue = typeof state.filters.q === 'string' ? state.filters.q : '';
  const allowedRunTypes = config.allowedRunTypes;
  const runTypeValue = useMemo(() => {
    const raw = state.filters.run_type;
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    if (allowedRunTypes && !allowedRunTypes.includes(raw as (typeof allowedRunTypes)[number])) {
      return undefined;
    }
    return raw as 'batch' | 'adversarial' | 'thread' | 'custom' | 'evaluation';
  }, [state.filters.run_type, allowedRunTypes]);
  const statusValue =
    typeof state.filters.status === 'string' && state.filters.status.length > 0
      ? state.filters.status
      : undefined;

  const loadRuns = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isInitialLoad.current) setLoading(true);
    setError('');

    fetchEvalRunsPaged({
      app_id: appId,
      page: state.page,
      page_size: state.pageSize,
      sort: state.sort,
      order: state.order,
      run_type: runTypeValue,
      status: statusValue,
      q: qValue || undefined,
      signal: controller.signal,
    })
      .then((res) => {
        stableSetItems(res.items);
        setTotalItems(res.totalItems);
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  }, [
    appId,
    state.page,
    state.pageSize,
    state.sort,
    state.order,
    runTypeValue,
    statusValue,
    qValue,
    stableSetItems,
  ]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns, location.key]);

  const trackedJobs = useJobTrackerStore((s) => s.activeJobs);
  const allRunIds = useMemo(() => new Set(items.map((r) => r.id)), [items]);
  const pendingTrackedJobs = useMemo(() => {
    if (!config.includeQueuedJobs) return [];
    if (state.page !== 1 || activeFilterCount > 0) return [];
    return trackedJobs
      .filter((j) => j.appId === appId)
      .filter((j) => !j.runId || !allRunIds.has(j.runId));
  }, [trackedJobs, allRunIds, appId, state.page, activeFilterCount, config.includeQueuedJobs]);

  const hasActive = useMemo(() => items.some((r) => isActive(r.status)), [items]);

  usePoll({
    fn: async () => {
      loadRuns();
      return true;
    },
    enabled: hasActive || pendingTrackedJobs.length > 0,
  });

  const tableData = useMemo((): RunsListRow[] => {
    const queuedRows: RunsListRow[] = pendingTrackedJobs.map((job) => ({
      id: job.jobId,
      kind: 'queued',
      runType: jobTypeToRunType(job.jobType),
      title: job.label,
      status: 'queued',
      score: '--',
      scoreColor: 'var(--text-muted)',
      dateStr: timeAgo(new Date(job.trackedAt).toISOString()),
      isRunning: false,
      hasHumanReview: false,
    }));

    const runRows: RunsListRow[] = items.map((run) => buildRunsListRow({ run, config }));

    return [...queuedRows, ...runRows];
  }, [items, pendingTrackedJobs, config]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setItems((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setTotalItems((t) => Math.max(0, t - 1));
      setDeleteTarget(null);
    } catch (e: unknown) {
      notificationService.error(e instanceof Error ? e.message : 'Delete failed', 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  const handleCancel = useCallback(
    async (jobId: string) => {
      try {
        await jobsApi.cancel(jobId);
        loadRuns();
      } catch {
        // Cancel failed silently — polling will show real status
      }
    },
    [loadRuns],
  );

  const handleRowClick = useCallback(
    (row: RunsListRow) => {
      if (row.kind === 'queued') return;
      navigate(config.resolveRowHref(row, appId));
    },
    [navigate, config, appId],
  );

  const columns = useMemo(
    () =>
      config.buildColumns({
        menuOpenId,
        setMenuOpenId,
        onDelete: (row) => setDeleteTarget({ id: row.id, label: row.title }),
        onCancel: handleCancel,
      }),
    [config, menuOpenId, handleCancel],
  );

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / state.pageSize));
  const sortState: SortState | undefined =
    state.sort && state.order ? { key: state.sort, order: state.order } : undefined;

  const filtered = activeFilterCount > 0;
  const panelFilterCount = Math.max(0, activeFilterCount - (qValue.trim().length > 0 ? 1 : 0));
  const emptyIcon = filtered ? Search : FlaskConical;
  const emptyTitle = filtered ? config.emptyCopy.filteredTitle : config.emptyCopy.defaultTitle;
  const emptyDescription = filtered
    ? config.emptyCopy.filteredDescription
    : config.emptyCopy.defaultDescription;

  const headerFilters = (
    <div className="flex items-center gap-2">
      <PageHeaderSearch
        value={qValue}
        onChange={(value) => setFilters({ q: value })}
        placeholder="Search runs…"
        label="Search runs"
      />
      <FilterButton
        activeCount={panelFilterCount}
        onClick={() => setFilterPanelOpen(true)}
        iconOnly
      />
    </div>
  );

  return (
    <PageSurface icon={icon} title={title} filters={headerFilters} actions={pageActions}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <DataTable
          columns={columns}
          data={tableData}
          keyExtractor={(row) => row.id}
          onRowClick={handleRowClick}
          loading={loading}
          emptyIcon={emptyIcon}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          sortState={sortState}
          onSortChange={setSort}
          pagination={{
            page: state.page,
            totalPages,
            pageSize: state.pageSize,
            totalItems,
            showCount: true,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
          }}
        />

        <FilterPanel
          open={filterPanelOpen}
          onClose={() => setFilterPanelOpen(false)}
          fields={config.filterFields}
          values={state.filters}
          onChange={setFilters}
          onClear={clearFilters}
        />

        <ConfirmDialog
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
          title="Delete Run"
          description={`Delete run "${deleteTarget?.label ?? ''}"? This cannot be undone.`}
          confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
          variant="danger"
          isLoading={isDeleting}
        />
      </div>
    </PageSurface>
  );
}
