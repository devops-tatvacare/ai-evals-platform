import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { usePoll } from '@/hooks';
import { useSearchParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { apiLogsForApp, inferAppIdFromPath, runDetailForApp, threadDetailForApp } from '@/config/routes';
import { Search, X, Trash2 } from 'lucide-react';
import { ConfirmDialog, Badge, ModelBadge } from '@/components/ui';
import { PageShell } from '@/components/ui/PageShell';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import type { ApiLogEntry } from '@/types';
import { fetchLogs, fetchRun, deleteLogs } from '@/services/api/evalRunsApi';
import { timeAgo } from '@/utils/evalFormatters';
import { TokenDisplay } from '../components/logs';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

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
  calls: number;
  errors: number;
  totalTimeMs: number;
  primaryModel: string;
  threads: number;
  dateStr: string;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function Logs() {
  const location = useLocation();
  const navigate = useNavigate();
  const appId = inferAppIdFromPath(location.pathname) ?? 'voice-rx';
  const [searchParams, setSearchParams] = useSearchParams();
  const runIdFilter = searchParams.get('run_id') || '';
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isLive, setIsLive] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ run_id: runIdFilter || undefined, app_id: appId, limit: 200 })
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
      .then((run) => setIsLive(!TERMINAL_STATUSES.includes(run.status.toLowerCase())))
      .catch(() => setIsLive(false));
  }, [runIdFilter]);

  usePoll({
    fn: async () => {
      const [logsResult, updatedRun] = await Promise.all([
        fetchLogs({ run_id: runIdFilter, app_id: appId, limit: 200 }),
        fetchRun(runIdFilter),
      ]);
      setLogs(logsResult.logs);
      if (TERMINAL_STATUSES.includes(updatedRun.status.toLowerCase())) {
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
      header: 'Run ID',
      render: (row) => (
        <Link
          to={runDetailForApp(appId, row.runId)}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-[13px] font-semibold text-[var(--text-brand)] hover:underline"
        >
          {row.runId.slice(0, 12)}
        </Link>
      ),
    },
    {
      key: 'calls',
      header: 'Calls',
      render: (row) => (
        <span className="text-xs text-[var(--text-primary)]">{row.calls}</span>
      ),
    },
    {
      key: 'errors',
      header: 'Errors',
      render: (row) =>
        row.errors > 0 ? (
          <span className="text-xs font-medium text-[var(--color-error)]">{row.errors}</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">&mdash;</span>
        ),
    },
    {
      key: 'totalTime',
      header: 'Total Time',
      render: (row) => (
        <span className="text-xs text-[var(--text-primary)]">
          {row.totalTimeMs > 0 ? `${(row.totalTimeMs / 1000).toFixed(1)}s` : '\u2014'}
        </span>
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
      render: (row) => (
        <span className="text-xs text-[var(--text-primary)]">{row.threads || '\u2014'}</span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      render: (row) => (
        <span className="text-xs text-[var(--text-muted)]">
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
          <span className="text-[13px] text-[var(--text-primary)] truncate block max-w-[300px]">
            {q ? highlightText(truncated, q) : truncated}
          </span>
        );
      },
    },
    {
      key: 'duration',
      header: 'Duration',
      render: (log) => (
        <span className="text-xs text-[var(--text-primary)]">
          {log.duration_ms != null ? formatDuration(log.duration_ms) : '\u2014'}
        </span>
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
        if (!log.thread_id) return <span className="text-xs text-[var(--text-muted)]">&mdash;</span>;
        const threadHref = threadDetailForApp(appId, log.thread_id, log.run_id);
        return threadHref ? (
          <Link to={threadHref} className="font-mono text-xs text-[var(--text-brand)] hover:underline">
            {log.thread_id.slice(0, 15)}
          </Link>
        ) : (
          <span className="font-mono text-xs text-[var(--text-muted)]">{log.thread_id.slice(0, 15)}</span>
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
        <span className="text-xs text-[var(--text-muted)]">{timeAgo(log.created_at)}</span>
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

  // ── Error state ─────────────────────────────────────────────────

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

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
      <button
        onClick={() => setConfirmDelete(true)}
        disabled={deleting || logs.length === 0}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
      >
        <Trash2 className="h-3 w-3" />
        {runIdFilter ? 'Delete Run Logs' : 'Delete All Logs'}
      </button>
    </>
  );

  // ── Search input ────────────────────────────────────────────────

  const searchInput = (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search logs..."
        className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] transition-colors"
      />
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      <PageShell
        title="API Logs"
        subtitle={subtitle}
        headerActions={headerActions}
        filterSlot={searchInput}
      >
        {isMultiRun ? (
          <DataTable
            columns={multiRunColumns}
            data={runGroupRows}
            keyExtractor={(row) => row.runId}
            onRowClick={(row) => navigate(`${apiLogsForApp(appId)}?run_id=${row.runId}`)}
            loading={loading}
            emptyTitle="No API logs found"
            emptyDescription="Run an evaluation to generate logs."
          />
        ) : (
          <DataTable
            columns={singleRunColumns}
            data={filteredLogs}
            keyExtractor={(log) => String(log.id)}
            loading={loading}
            emptyTitle="No API logs found"
          />
        )}
      </PageShell>

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
