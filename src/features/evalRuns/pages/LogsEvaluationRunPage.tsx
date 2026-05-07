import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

import { useCurrentAppId, usePoll } from '@/hooks';
import {
  apiLogsForApp,
  threadDetailForApp,
} from '@/config/routes';
import {
  Badge,
  Button,
  ConfirmDialog,
  ModelBadge,
  PageHeaderSearch,
  PageSurface,
} from '@/components/ui';
import { DataTable } from '@/components/ui/DataTable';
import type { ColumnDef } from '@/components/ui/DataTable';
import { usePageMetadata } from '@/config/pageMetadata';
import type { ApiLogEntry } from '@/types';
import { isTerminalRunStatus } from '@/types';
import { fetchLogs, fetchRun, deleteLogs } from '@/services/api/evalRunsApi';
import { humanize, timeAgo } from '@/utils/evalFormatters';
import { TokenDisplay } from '../components/logs/TokenDisplay';

const LOGS_FETCH_CAP = 1000;
const DEFAULT_PAGE_SIZE = 25;

function cleanPromptPreview(prompt: string, method: string): string {
  if (method === 'stream_message') {
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.query) return String(parsed.query);
      if (parsed.message) return String(parsed.message);
    } catch { /* fallback */ }
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
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 1 ? <>{parts}</> : text;
}

/**
 * Phase 15.1b — sub-route page under `/logs/runs/:runId`. Replaces the old
 * inline `?run_id=` filter on the Logs page so the drill-down has a real
 * URL, a real page surface, and a real back button. Mirrors the legacy
 * single-run table+expansion logic — same columns, same DataTable
 * primitive, same delete affordance — only the chrome changed.
 */
export default function LogsEvaluationRunPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('logs');

  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [runName, setRunName] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ run_id: runId, app_id: appId, limit: LOGS_FETCH_CAP })
      .then((r) => {
        setLogs(r.logs);
        setRunName(r.logs[0]?.run_name ?? null);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runId, appId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!runId) {
      setIsLive(false);
      return;
    }
    fetchRun(runId)
      .then((run) => setIsLive(!isTerminalRunStatus(run.status)))
      .catch(() => setIsLive(false));
  }, [runId]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  usePoll({
    fn: async () => {
      const [logsResult, updatedRun] = await Promise.all([
        fetchLogs({ run_id: runId, app_id: appId, limit: LOGS_FETCH_CAP }),
        fetchRun(runId),
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

  const searchCorpus = useMemo(
    () =>
      logs.map((l) =>
        [
          l.run_id,
          l.thread_id,
          l.test_case_label,
          l.provider,
          l.model,
          l.method,
          l.prompt,
          l.system_prompt,
          l.response,
          l.error,
        ]
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

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteLogs(runId, appId);
      setConfirmDelete(false);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const q = searchQuery.trim();

  const columns: ColumnDef<ApiLogEntry>[] = useMemo(() => [
    {
      key: 'method',
      header: 'Method',
      render: (log) => {
        const methodLabel =
          log.method === 'generate_json' ? 'JSON' : log.method === 'stream_message' ? 'API' : 'TEXT';
        const methodVariant =
          log.method === 'generate_json' ? 'info' : log.method === 'stream_message' ? 'warning' : 'primary';
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
        const truncated = clean.length > 90 ? `${clean.slice(0, 90)}…` : clean;
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
        <span>{log.duration_ms != null ? formatDuration(log.duration_ms) : '—'}</span>
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
        if (!log.thread_id) return <span className="text-[var(--text-muted)]">—</span>;
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

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = filteredLogs.slice(pageStart, pageStart + pageSize);

  const renderLogDetail = useCallback(
    (log: ApiLogEntry) => (
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
    ),
    [],
  );

  const evalType = logs[0]?.eval_type ?? null;
  const subtitle = `${filteredLogs.length}${searchQuery.trim() ? ` of ${logs.length}` : ''} entries${evalType ? ` · ${humanize(evalType)}` : ''}`;
  const title = runName ?? `Run ${runId.slice(0, 12)}`;

  return (
    <PageSurface
      icon={icon}
      title={title}
      subtitle={subtitle}
      back={{ to: `${apiLogsForApp(appId)}?type=evaluation-runs`, label: 'Logs' }}
      filters={
        <PageHeaderSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search logs…"
          label="Search logs"
        />
      }
      actions={
        <>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-success)] font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
              Live
            </span>
          )}
          <Button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || logs.length === 0}
            variant="danger-outline"
            size="sm"
            icon={Trash2}
            iconOnly
            aria-label="Delete run logs"
            title="Delete run logs"
            isLoading={deleting}
          >
            Delete Run Logs
          </Button>
        </>
      }
    >
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
          keyExtractor={(log) => String(log.id)}
          renderExpandedRow={renderLogDetail}
          loading={loading}
          pagination={{
            page: safePage,
            totalPages,
            pageSize,
            totalItems: filteredLogs.length,
            showCount: true,
            onPageChange: setPage,
            onPageSizeChange: (n) => {
              setPageSize(n);
              setPage(1);
            },
          }}
          emptyTitle="No API logs found"
          emptyDescription={searchQuery.trim() ? `No log entries match "${searchQuery.trim()}"` : undefined}
        />
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Logs"
        description={`Delete all logs for run ${runId.slice(0, 12)}...? This cannot be undone.`}
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={deleting}
      />
    </PageSurface>
  );
}
