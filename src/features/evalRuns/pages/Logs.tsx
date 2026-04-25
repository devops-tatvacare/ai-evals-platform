import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useCurrentAppId, usePoll } from '@/hooks';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { apiLogsForApp, runDetailForApp, threadDetailForApp } from '@/config/routes';
import { X, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Badge, ModelBadge, PageHeaderSearch, PageSurface } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import type { ApiLogEntry } from '@/types';
import { isTerminalRunStatus } from '@/types';
import { fetchLogs, fetchRun, deleteLogs } from '@/services/api/evalRunsApi';
import { timeAgo, humanize } from '@/utils/evalFormatters';
import { TokenDisplay } from '../components/logs';

/* ── Helper functions ──────────────────────────────────────────── */

function cleanPromptPreview(prompt: string, method: string): string {
  if (method === 'stream_message') {
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.query) return String(parsed.query);
      if (parsed.message) return String(parsed.message);
    } catch { /* fallback to raw */ }
  }
  return prompt
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*+]\s/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Split text on query matches and wrap hits in <mark>. */
function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="bg-yellow-300/60 dark:bg-yellow-400/40 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 1 ? <>{parts}</> : text;
}

/* ── Types ─────────────────────────────────────────────────────── */

interface RunGroup {
  runId: string;
  logs: ApiLogEntry[];
  earliest: string;
  latest: string;
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

/* ── Component ─────────────────────────────────────────────────── */

// Client-side pagination cap. Search & filtering need to operate over the
// whole window, so we fetch a generous slice and paginate locally — same
// pattern used by Admin Users / Inside Sales / Cost tabs. If a hit-cap
// banner becomes a real ask, surface ``logsTotal > LOGS_FETCH_CAP``.
const LOGS_FETCH_CAP = 1000;
const DEFAULT_PAGE_SIZE = 25;

export default function Logs() {
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const [searchParams, setSearchParams] = useSearchParams();
  const runIdFilter = searchParams.get('run_id') || '';
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ run_id: runIdFilter || undefined, app_id: appId, limit: LOGS_FETCH_CAP })
      .then((r) => {
        setLogs(r.logs);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runIdFilter, appId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!runIdFilter) { setIsLive(false); return; }
    fetchRun(runIdFilter)
      .then((run) => setIsLive(!isTerminalRunStatus(run.status)))
      .catch(() => setIsLive(false));
  }, [runIdFilter]);

  // Reset to first page whenever the underlying dataset or filter changes —
  // otherwise switching views or typing a search can land on an empty page.
  useEffect(() => { setPage(1); }, [runIdFilter, searchQuery]);

  usePoll({
    fn: async () => {
      const [logsResult, updatedRun] = await Promise.all([
        fetchLogs({ run_id: runIdFilter, app_id: appId, limit: LOGS_FETCH_CAP }),
        fetchRun(runIdFilter),
      ]);
      setLogs(logsResult.logs);
      if (isTerminalRunStatus(updatedRun.status)) {
        setIsLive(false);
        return false;
      }
      return true;
    },
    enabled: isLive,
  });

  // Precompute search corpus
  const searchCorpus = useMemo(
    () =>
      logs.map((l) =>
        [l.run_id, l.thread_id, l.test_case_label, l.provider, l.model, l.method, l.prompt, l.system_prompt, l.response, l.error]
          .filter(Boolean)
          .join('\0')
          .toLowerCase()
      ),
    [logs]
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
        latest: timestamps.length > 0 ? timestamps[0] : '',
        errorCount: groupLogs.filter((l) => !!l.error).length,
        totalDurationMs: groupLogs.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0),
      });
    }
    return groups;
  }, [filteredLogs]);

  // Map run groups to flat rows for DataTable
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
      await deleteLogs(runIdFilter || undefined, appId);
      setConfirmDelete(false);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleClearFilter = () => {
    setSearchParams({});
  };

  // ── Column definitions ──────────────────────────────────────────

  const multiRunColumns: ColumnDef<RunGroupRow>[] = useMemo(() => [
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
            <span className="font-mono text-[length:var(--text-table-header)] text-[var(--text-muted)]">{row.runId.slice(0, 12)}</span>
          )}
        </div>
      ),
    },
    {
      key: 'evalType',
      header: 'Type',
      render: (row) => (
        <span className="text-[var(--text-secondary)]">{row.evalType ? humanize(row.evalType) : '\u2014'}</span>
      ),
    },
    {
      key: 'calls',
      header: 'Calls',
      render: (row) => <span>{row.calls}</span>,
    },
    {
      key: 'errors',
      header: 'Errors',
      render: (row) =>
        row.errors > 0 ? (
          <span className="font-medium text-[var(--color-error)]">{row.errors}</span>
        ) : (
          <span className="text-[var(--text-muted)]">&mdash;</span>
        ),
    },
    {
      key: 'totalTime',
      header: 'Total Time',
      render: (row) => (
        <span>{row.totalTimeMs > 0 ? formatDuration(row.totalTimeMs) : '\u2014'}</span>
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
      render: (row) => <span>{row.threads || '\u2014'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="text-[var(--text-muted)]">
          {row.dateStr ? timeAgo(row.dateStr) : ''}
        </span>
      ),
    },
  ], [appId]);

  const q = searchQuery.trim();

  const singleRunColumns: ColumnDef<ApiLogEntry>[] = useMemo(() => [
    {
      key: 'method',
      header: 'Method',
      render: (log) => {
        const methodLabel = log.method === 'generate_json' ? 'JSON' : log.method === 'stream_message' ? 'API' : 'TEXT';
        const methodVariant = log.method === 'generate_json' ? 'info' : log.method === 'stream_message' ? 'warning' : 'primary';
        return (
          <Badge variant={methodVariant} size="sm" className="shrink-0 uppercase text-[0.6rem] font-bold">
            {methodLabel}
          </Badge>
        );
      },
    },
    {
      key: 'prompt',
      header: 'Prompt',
      render: (log) => {
        const clean = cleanPromptPreview(log.prompt, log.method);
        const truncated = clean.length > 90 ? `${clean.slice(0, 90)}\u2026` : clean;
        return (
          <span className="truncate block max-w-[300px]">
            {q ? highlightText(truncated, q) : truncated}
          </span>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (log) => (
        <span>{log.duration_ms != null ? formatDuration(log.duration_ms) : '\u2014'}</span>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (log) => <ModelBadge modelName={log.model} variant="inline" />,
    },
    {
      key: 'thread',
      header: 'Thread',
      render: (log) => {
        if (!log.thread_id) return <span className="text-[var(--text-muted)]">&mdash;</span>;
        const threadHref = threadDetailForApp(appId, log.thread_id, log.run_id);
        return threadHref ? (
          <Link to={threadHref} className="font-mono text-[var(--text-brand)] hover:underline">
            {log.thread_id.slice(0, 15)}
          </Link>
        ) : (
          <span className="font-mono text-[var(--text-muted)]">{log.thread_id.slice(0, 15)}</span>
        );
      },
    },
    {
      key: 'tokens',
      header: 'Tokens',
      render: (log) => <TokenDisplay tokensIn={log.tokens_in} tokensOut={log.tokens_out} />,
    },
    {
      key: 'date',
      header: 'Date',
      render: (log) => (
        <span className="text-[var(--text-muted)]">{timeAgo(log.created_at)}</span>
      ),
    },
  ], [appId, q]);

  // ── Subtitle ────────────────────────────────────────────────────

  const isMultiRun = !runIdFilter;
  const isSearching = !!q;

  const subtitle = isMultiRun
    ? `${filteredLogs.length} entries across ${runGroups.length} runs`
    : isSearching
      ? `${filteredLogs.length} of ${logs.length} entries`
      : `${filteredLogs.length} entries`;

  // ── Pagination ──────────────────────────────────────────────────
  // Both views paginate over the same fetch window (LOGS_FETCH_CAP) so
  // search keeps working across pages. Multi-run paginates by run group;
  // single-run paginates by individual log entry.
  const activeRows = isMultiRun ? runGroupRows : filteredLogs;
  const totalItems = activeRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedMultiRunRows = useMemo(
    () => (isMultiRun ? runGroupRows.slice(pageStart, pageStart + pageSize) : []),
    [isMultiRun, runGroupRows, pageStart, pageSize],
  );
  const pagedSingleRunRows = useMemo(
    () => (isMultiRun ? [] : filteredLogs.slice(pageStart, pageStart + pageSize)),
    [isMultiRun, filteredLogs, pageStart, pageSize],
  );
  const paginationProps = {
    page: safePage,
    totalPages,
    pageSize,
    totalItems,
    showCount: true,
    onPageChange: setPage,
    onPageSizeChange: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
  };

  // ── Expanded log detail ─────────────────────────────────────────

  const renderLogDetail = useCallback((log: ApiLogEntry) => (
    <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-xs max-w-[900px]">
      {log.system_prompt && (
        <>
          <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider pt-0.5">System</span>
          <pre className="whitespace-pre-wrap break-words text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded px-3 py-2 max-h-40 overflow-y-auto">{log.system_prompt}</pre>
        </>
      )}
      <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider pt-0.5">Prompt</span>
      <pre className="whitespace-pre-wrap break-words text-[var(--text-primary)] bg-[var(--bg-tertiary)] rounded px-3 py-2 max-h-60 overflow-y-auto">{log.prompt}</pre>
      {log.response && (
        <>
          <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider pt-0.5">Response</span>
          <pre className="whitespace-pre-wrap break-words text-[var(--text-primary)] bg-[var(--bg-tertiary)] rounded px-3 py-2 max-h-60 overflow-y-auto">{log.response}</pre>
        </>
      )}
      {log.error && (
        <>
          <span className="font-semibold text-[var(--color-error)] uppercase tracking-wider pt-0.5">Error</span>
          <pre className="whitespace-pre-wrap break-words text-[var(--color-error)] bg-[var(--surface-error)] rounded px-3 py-2 max-h-40 overflow-y-auto">{log.error}</pre>
        </>
      )}
      <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wider">Meta</span>
      <div className="flex items-center gap-4 text-[var(--text-secondary)]">
        <span>{log.provider}/{log.model}</span>
        {log.duration_ms != null && <span>{formatDuration(log.duration_ms)}</span>}
        <TokenDisplay tokensIn={log.tokens_in} tokensOut={log.tokens_out} />
      </div>
    </div>
  ), []);

  // ── Page metadata ───────────────────────────────────────────────

  const { icon, title } = usePageMetadata('logs');

  // ── Error state ─────────────────────────────────────────────────

  // ── Header actions ──────────────────────────────────────────────

  const headerActions = (
    <>
      {isLive && (
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)] font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
          Live
        </span>
      )}
      {runIdFilter && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">Run:</span>
          <Link
            to={runDetailForApp(appId, runIdFilter)}
            className="font-mono text-[var(--text-brand)] hover:underline"
          >
            {runIdFilter.slice(0, 12)}
          </Link>
          <button
            onClick={handleClearFilter}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] rounded"
            title="Clear filter"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <Button
        onClick={() => setConfirmDelete(true)}
        disabled={deleting || logs.length === 0}
        variant="danger-outline"
        size="sm"
        icon={Trash2}
        iconOnly
        aria-label={runIdFilter ? 'Delete run logs' : 'Delete all logs'}
        title={runIdFilter ? 'Delete run logs' : 'Delete all logs'}
        isLoading={deleting}
      >
        {runIdFilter ? 'Delete Run Logs' : 'Delete All Logs'}
      </Button>
    </>
  );
  const headerFilters = (
    <PageHeaderSearch
      value={searchQuery}
      onChange={setSearchQuery}
      placeholder="Search logs…"
      label="Search logs"
    />
  );

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      <PageSurface
        icon={icon}
        title={title}
        subtitle={subtitle}
        back={runIdFilter ? { to: apiLogsForApp(appId), label: 'Logs' } : undefined}
        filters={headerFilters}
        actions={headerActions}
      >
        {error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center py-8">
            <div className="w-full max-w-xl rounded-lg border border-[var(--border-error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--color-error)]">
              {error}
            </div>
          </div>
        ) : (
          <>
            {isMultiRun ? (
              <DataTable
                columns={multiRunColumns}
                data={pagedMultiRunRows}
                keyExtractor={(row) => row.runId}
                onRowClick={(row) => navigate(`${apiLogsForApp(appId)}?run_id=${row.runId}`)}
                loading={loading}
                pagination={paginationProps}
                emptyTitle="No API logs found"
                emptyDescription={isSearching ? `No runs match "${q}"` : 'Run an evaluation to generate logs.'}
              />
            ) : (
              <DataTable
                columns={singleRunColumns}
                data={pagedSingleRunRows}
                keyExtractor={(log) => String(log.id)}
                renderExpandedRow={renderLogDetail}
                loading={loading}
                pagination={paginationProps}
                emptyTitle="No API logs found"
                emptyDescription={isSearching ? `No log entries match "${q}"` : undefined}
              />
            )}
          </>
        )}
      </PageSurface>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Logs"
        description={
          runIdFilter
            ? `Delete all logs for run ${runIdFilter.slice(0, 12)}...? This cannot be undone.`
            : `Delete ALL ${logs.length} log entries? This cannot be undone.`
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={deleting}
      />
    </>
  );
}
