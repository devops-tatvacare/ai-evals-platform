import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { usePoll } from '@/hooks';
import { apiLogsForApp, runDetailForApp } from '@/config/routes';
import { Button, ConfirmDialog, ModelBadge, PageHeaderSearch } from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import type { ApiLogEntry } from '@/types';
import { fetchLogs, deleteLogs } from '@/services/api/evalRunsApi';
import { humanize, timeAgo } from '@/utils/evalFormatters';

const LOGS_FETCH_CAP = 1000;
const DEFAULT_PAGE_SIZE = 25;

interface RunGroup {
  runId: string;
  logs: ApiLogEntry[];
  earliest: string;
  errorCount: number;
  totalDurationMs: number;
}

interface RunGroupRow {
  runId: string;
  runName: string | null;
  evalType: string | null;
  calls: number;
  errors: number;
  totalTimeMs: number;
  primaryModel: string;
  threads: number;
  dateStr: string;
}

interface EvaluationRunsTabProps {
  appId: string;
  /** Reports a per-tab subtitle (entry counts) up to the page-level header. */
  onSubtitleChange?: (subtitle: string) => void;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Phase 15.1b — multi-run summary view only. Single-run drill-down moved
 * to the sub-route `/logs/runs/:runId` (LogsEvaluationRunPage) so the
 * drill has a real URL, real page chrome, real back button. Row click
 * navigates instead of filtering inline. Pol-bypass: the live indicator
 * + delete-all-for-run lived alongside the inline filter and are
 * meaningless in the multi-run view; deletions across all runs stay here.
 */
export function EvaluationRunsTab({ appId, onSubtitleChange }: EvaluationRunsTabProps) {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ app_id: appId, limit: LOGS_FETCH_CAP })
      .then((r) => {
        setLogs(r.logs);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [appId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  // Light polling — keep the multi-run view fresh without dependency on
  // any active run state (per-run live polling now lives on the sub-route
  // page where it's actually relevant).
  usePoll({
    fn: async () => {
      const r = await fetchLogs({ app_id: appId, limit: LOGS_FETCH_CAP });
      setLogs(r.logs);
      return true;
    },
    enabled: false,
  });

  const searchCorpus = useMemo(
    () =>
      logs.map((l) =>
        [l.run_id, l.thread_id, l.test_case_label, l.provider, l.model, l.method, l.prompt, l.system_prompt, l.response, l.error]
          .filter(Boolean)
          .join('\0')
          .toLowerCase(),
      ),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((_, i) => searchCorpus[i].includes(q));
  }, [logs, searchQuery, searchCorpus]);

  const runGroups = useMemo((): RunGroup[] => {
    const map = new Map<string, ApiLogEntry[]>();
    for (const log of filteredLogs) {
      const key = log.run_id || '(no run)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    const groups: RunGroup[] = [];
    for (const [runId, groupLogs] of map) {
      const timestamps = groupLogs.map((l) => l.created_at).filter(Boolean);
      groups.push({
        runId,
        logs: groupLogs,
        earliest: timestamps.length > 0 ? timestamps[timestamps.length - 1] : '',
        errorCount: groupLogs.filter((l) => !!l.error).length,
        totalDurationMs: groupLogs.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0),
      });
    }
    return groups;
  }, [filteredLogs]);

  const runGroupRows = useMemo((): RunGroupRow[] => {
    return runGroups.map((g) => {
      const threadSet = new Set(g.logs.map((l) => l.thread_id).filter(Boolean));
      return {
        runId: g.runId,
        runName: g.logs[0]?.run_name ?? null,
        evalType: g.logs[0]?.eval_type ?? null,
        calls: g.logs.length,
        errors: g.errorCount,
        totalTimeMs: g.totalDurationMs,
        primaryModel: g.logs[0]?.model ?? '',
        threads: threadSet.size,
        dateStr: g.earliest,
      };
    });
  }, [runGroups]);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteLogs(undefined, appId);
      setConfirmDelete(false);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const columns: ColumnDef<RunGroupRow>[] = useMemo(() => [
    {
      key: 'runId',
      header: 'Run',
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <Link
            to={runDetailForApp(appId, row.runId)}
            onClick={(e) => e.stopPropagation()}
            className="font-mono font-semibold text-[var(--text-brand)] hover:underline"
          >
            {row.runName || row.runId.slice(0, 12)}
          </Link>
          {row.runName && (
            <span className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]">
              {row.runId.slice(0, 12)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'evalType',
      header: 'Type',
      render: (row) => (
        <span className="text-[var(--text-secondary)]">{row.evalType ? humanize(row.evalType) : '—'}</span>
      ),
    },
    { key: 'calls', header: 'Calls', render: (row) => <span>{row.calls}</span> },
    {
      key: 'errors',
      header: 'Errors',
      render: (row) =>
        row.errors > 0 ? (
          <span className="font-medium text-[var(--color-error)]">{row.errors}</span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        ),
    },
    {
      key: 'totalTime',
      header: 'Total Time',
      render: (row) => (
        <span>{row.totalTimeMs > 0 ? formatDuration(row.totalTimeMs) : '—'}</span>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) =>
        row.primaryModel ? <ModelBadge modelName={row.primaryModel} variant="inline" /> : null,
    },
    {
      key: 'threads',
      header: 'Threads',
      render: (row) => <span>{row.threads || '—'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="text-[var(--text-muted)]">{row.dateStr ? timeAgo(row.dateStr) : ''}</span>
      ),
    },
  ], [appId]);

  const isSearching = !!searchQuery.trim();
  const subtitle = `${filteredLogs.length} entries across ${runGroups.length} runs`;

  useEffect(() => {
    onSubtitleChange?.(subtitle);
  }, [subtitle, onSubtitleChange]);

  const totalItems = runGroupRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = useMemo(
    () => runGroupRows.slice(pageStart, pageStart + pageSize),
    [runGroupRows, pageStart, pageSize],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 max-w-md">
          <PageHeaderSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search logs…"
            label="Search logs"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || logs.length === 0}
            variant="danger-outline"
            size="sm"
            icon={Trash2}
            iconOnly
            aria-label="Delete all logs"
            title="Delete all logs"
            isLoading={deleting}
          >
            Delete All Logs
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center py-8">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={pagedRows}
          keyExtractor={(row) => row.runId}
          onRowClick={(row) => navigate(`${apiLogsForApp(appId)}/runs/${row.runId}`)}
          loading={loading}
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
          emptyTitle="No API logs found"
          emptyDescription={
            isSearching ? `No runs match "${searchQuery.trim()}"` : 'Run an evaluation to generate logs.'
          }
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Logs"
        description={`Delete ALL ${logs.length} log entries? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
