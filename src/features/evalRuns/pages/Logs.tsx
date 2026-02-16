import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import type { ApiLogEntry } from "@/types";
import { fetchLogs, deleteLogs } from "@/services/api/evalRunsApi";
import { timeAgo } from "@/utils/evalFormatters";

export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runIdFilter = searchParams.get("run_id") || "";
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ run_id: runIdFilter || undefined, limit: 200 })
      .then((r) => {
        setLogs(r.logs);
        setError("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runIdFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    const scope = runIdFilter ? `logs for run ${runIdFilter.slice(0, 12)}` : "ALL logs";
    if (!window.confirm(`Delete ${scope}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteLogs(runIdFilter || undefined);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleClearFilter = () => {
    setSearchParams({});
  };

  // Group logs by thread_id for display
  const threadIds = [...new Set(logs.map((l) => l.thread_id).filter(Boolean))];

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-[var(--text-primary)]">API Logs</h1>
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {logs.length} entries
          </span>
        </div>
        <div className="flex items-center gap-2">
          {runIdFilter && (
            <div className="flex items-center gap-1.5 text-[var(--text-xs)]">
              <span className="text-[var(--text-muted)]">Run:</span>
              <Link
                to={`/kaira/runs/${runIdFilter}`}
                className="font-mono text-[var(--text-brand)] hover:underline"
              >
                {runIdFilter.slice(0, 12)}
              </Link>
              <button
                onClick={handleClearFilter}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1"
                title="Clear filter"
              >
                x
              </button>
            </div>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting || logs.length === 0}
            className="px-2.5 py-1 text-[var(--text-xs)] font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting..." : runIdFilter ? "Delete Run Logs" : "Delete All Logs"}
          </button>
        </div>
      </div>

      {runIdFilter && threadIds.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold">
            Threads:
          </span>
          {threadIds.map((tid) => (
            <span
              key={tid}
              className="px-1.5 py-0.5 rounded text-[var(--text-xs)] font-mono bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
            >
              {tid!.slice(0, 20)}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">
          No API logs found.{" "}
          {!runIdFilter && "Run an evaluation from the CLI to generate logs."}
        </div>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              expanded={expandedId === log.id}
              onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
              showRunId={!runIdFilter}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
  showRunId,
}: {
  log: ApiLogEntry;
  expanded: boolean;
  onToggle: () => void;
  showRunId: boolean;
}) {
  const hasError = !!log.error;
  const borderColor = hasError ? "border-l-[var(--color-error)]" : "border-l-[var(--color-success)]";

  return (
    <div className={`bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md overflow-hidden border-l-[3px] ${borderColor}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 px-1.5 py-px rounded text-[0.6rem] font-bold uppercase ${
              log.method === "generate_json"
                ? "bg-[var(--color-accent-purple)] text-white"
                : "bg-[var(--color-info)] text-white"
            }`}
          >
            {log.method === "generate_json" ? "JSON" : "TEXT"}
          </span>
          <span className="text-[var(--text-sm)] font-medium text-[var(--text-primary)] truncate">
            {log.prompt.slice(0, 80)}{log.prompt.length > 80 ? "..." : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {log.thread_id && (
            <span className="text-[var(--text-xs)] font-mono text-[var(--text-muted)] hidden md:inline">
              {log.thread_id.slice(0, 15)}
            </span>
          )}
          {showRunId && (
            <Link
              to={`/kaira/runs/${log.run_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[var(--text-xs)] font-mono text-[var(--text-brand)] hover:underline hidden md:inline"
            >
              {log.run_id.slice(0, 8)}
            </Link>
          )}
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {log.duration_ms != null ? `${log.duration_ms.toFixed(0)}ms` : ""}
          </span>
          <span className="text-[var(--text-xs)] text-[var(--text-tertiary)]">
            {log.model}
          </span>
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {timeAgo(log.created_at)}
          </span>
          <span className="text-[var(--text-xs)] text-[var(--text-tertiary)]">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[var(--text-xs)]">
            <div>
              <span className="text-[var(--text-muted)]">Provider</span>
              <p className="font-medium text-[var(--text-primary)]">{log.provider}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Model</span>
              <p className="font-medium text-[var(--text-primary)]">{log.model}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Method</span>
              <p className="font-medium text-[var(--text-primary)]">{log.method}</p>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Duration</span>
              <p className="font-medium text-[var(--text-primary)]">
                {log.duration_ms != null ? `${log.duration_ms.toFixed(1)}ms` : "\u2014"}
              </p>
            </div>
          </div>

          {log.thread_id && (
            <div className="text-[var(--text-xs)]">
              <span className="text-[var(--text-muted)]">Thread ID: </span>
              <Link
                to={`/kaira/threads/${log.thread_id}`}
                className="font-mono text-[var(--text-brand)] hover:underline"
              >
                {log.thread_id}
              </Link>
            </div>
          )}

          {log.system_prompt && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">
                System Prompt
              </p>
              <pre className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                {log.system_prompt}
              </pre>
            </div>
          )}

          <div>
            <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">
              Prompt
            </p>
            <pre className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
              {log.prompt}
            </pre>
          </div>

          {log.response && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-success)] font-semibold mb-1">
                Response
              </p>
              <pre className="bg-[var(--surface-success)] border border-[var(--border-success)] rounded p-2.5 text-[var(--text-xs)] text-[var(--text-primary)] whitespace-pre-wrap max-h-64 overflow-y-auto">
                {formatResponse(log.response)}
              </pre>
            </div>
          )}

          {log.error && (
            <div>
              <p className="text-[var(--text-xs)] uppercase tracking-wider text-[var(--color-error)] font-semibold mb-1">
                Error
              </p>
              <pre className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-2.5 text-[var(--text-xs)] text-[var(--color-error)] whitespace-pre-wrap">
                {log.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
