import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ScrollText, ChevronDown, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { EmptyState, ConfirmDialog } from "@/components/ui";
import type { ApiLogEntry } from "@/types";
import { fetchLogs, fetchRun, deleteLogs } from "@/services/api/evalRunsApi";
import { timeAgo } from "@/utils/evalFormatters";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "interrupted"];

interface RunGroup {
  runId: string;
  logs: ApiLogEntry[];
  earliest: string;
  latest: string;
  errorCount: number;
  totalDurationMs: number;
}

export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runIdFilter = searchParams.get("run_id") || "";
  const [logs, setLogs] = useState<ApiLogEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [collapsedRuns, setCollapsedRuns] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Live polling: check if the run is active, then poll logs + run status
  useEffect(() => {
    if (!runIdFilter) {
      setIsLive(false);
      return;
    }

    let cancelled = false;

    async function checkAndPoll() {
      try {
        const run = await fetchRun(runIdFilter);
        if (cancelled) return;
        const active = !TERMINAL_STATUSES.includes(run.status.toLowerCase());
        setIsLive(active);

        if (active) {
          pollingRef.current = setInterval(async () => {
            if (cancelled) return;
            try {
              const [logsResult, updatedRun] = await Promise.all([
                fetchLogs({ run_id: runIdFilter, limit: 200 }),
                fetchRun(runIdFilter),
              ]);
              if (cancelled) return;
              setLogs(logsResult.logs);
              if (TERMINAL_STATUSES.includes(updatedRun.status.toLowerCase())) {
                setIsLive(false);
                if (pollingRef.current) {
                  clearInterval(pollingRef.current);
                  pollingRef.current = null;
                }
              }
            } catch {
              // Polling error — keep trying
            }
          }, 3000);
        }
      } catch {
        // Run fetch failed — not live
      }
    }

    checkAndPoll();

    return () => {
      cancelled = true;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [runIdFilter]);

  // Client-side search filter (matches run_id or thread_id)
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (l.run_id && l.run_id.toLowerCase().includes(q)) ||
        (l.thread_id && l.thread_id.toLowerCase().includes(q))
    );
  }, [logs, searchQuery]);

  // Group logs by run_id (for unfiltered view)
  const runGroups = useMemo((): RunGroup[] => {
    const map = new Map<string, ApiLogEntry[]>();
    for (const log of filteredLogs) {
      const key = log.run_id || "(no run)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    const groups: RunGroup[] = [];
    for (const [runId, groupLogs] of map) {
      const timestamps = groupLogs.map((l) => l.created_at).filter(Boolean);
      groups.push({
        runId,
        logs: groupLogs,
        earliest: timestamps.length > 0 ? timestamps[timestamps.length - 1] : "",
        latest: timestamps.length > 0 ? timestamps[0] : "",
        errorCount: groupLogs.filter((l) => !!l.error).length,
        totalDurationMs: groupLogs.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0),
      });
    }
    return groups;
  }, [logs]);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteLogs(runIdFilter || undefined);
      setConfirmDelete(false);
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

  const toggleRunCollapse = (runId: string) => {
    setCollapsedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const collapseAll = () => setCollapsedRuns(new Set(runGroups.map((g) => g.runId)));
  const expandAll = () => setCollapsedRuns(new Set());

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  // When filtered by run_id, show flat list (existing behavior)
  const showGrouped = !runIdFilter && runGroups.length > 1;

  return (
    <div className="space-y-4 flex-1 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-[var(--text-primary)]">API Logs</h1>
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {filteredLogs.length}{searchQuery ? `/${logs.length}` : ""} entries
            {showGrouped && ` across ${runGroups.length} runs`}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 text-[var(--text-xs)] font-medium text-[var(--color-info)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-info)] opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-info)]" />
              </span>
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showGrouped && (
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="px-2 py-1 text-[var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                Expand all
              </button>
              <span className="text-[var(--text-muted)]">/</span>
              <button
                onClick={collapseAll}
                className="px-2 py-1 text-[var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
              >
                Collapse all
              </button>
            </div>
          )}
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
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] rounded"
                title="Clear filter"
              >
                x
              </button>
            </div>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={deleting || logs.length === 0}
            className="px-2.5 py-1 text-[var(--text-xs)] font-medium text-[var(--color-error)] bg-[var(--surface-error)] border border-[var(--border-error)] rounded hover:opacity-80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
          >
            {runIdFilter ? "Delete Run Logs" : "Delete All Logs"}
          </button>
        </div>
      </div>

      {/* Search */}
      {!loading && logs.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by run ID or thread ID..."
            className="w-full pl-9 pr-8 py-2 text-[13px] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)] focus:border-transparent transition-shadow"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-[0.8rem] text-[var(--text-muted)]">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={ScrollText}
            title="No API logs found"
            description={!runIdFilter ? "Run an evaluation to generate logs." : undefined}
          />
        </div>
      ) : filteredLogs.length === 0 && searchQuery ? (
        <div className="flex-1 min-h-full flex items-center justify-center">
          <EmptyState
            icon={Search}
            title="No matching logs"
            description={`No logs match "${searchQuery}". Try a different run ID or thread ID.`}
          />
        </div>
      ) : showGrouped ? (
        /* Grouped by run ID */
        <div className="space-y-3">
          {runGroups.map((group) => (
            <RunGroupCard
              key={group.runId}
              group={group}
              collapsed={collapsedRuns.has(group.runId)}
              onToggleCollapse={() => toggleRunCollapse(group.runId)}
              expandedLogId={expandedId}
              onToggleLog={(id) => setExpandedId(expandedId === id ? null : id)}
            />
          ))}
        </div>
      ) : (
        /* Flat list (filtered by run_id or single run) */
        <div className="space-y-1">
          {filteredLogs.map((log) => (
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
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        variant="danger"
        isLoading={deleting}
      />
    </div>
  );
}

/* ── Run Group Card ─────────────────────────────────────────────── */

function RunGroupCard({
  group,
  collapsed,
  onToggleCollapse,
  expandedLogId,
  onToggleLog,
}: {
  group: RunGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedLogId: number | null;
  onToggleLog: (id: number) => void;
}) {
  const hasErrors = group.errorCount > 0;

  return (
    <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
      {/* Group header */}
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)]/60 hover:bg-[var(--bg-secondary)] transition-colors text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
        )}

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            to={`/kaira/runs/${group.runId}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[13px] font-semibold text-[var(--text-brand)] hover:underline shrink-0"
          >
            {group.runId.slice(0, 12)}
          </Link>

          <div className="flex items-center gap-2 text-[var(--text-xs)] text-[var(--text-muted)]">
            <span>{group.logs.length} calls</span>
            <span className="text-[var(--text-tertiary)]">&middot;</span>
            <span>{group.totalDurationMs > 0 ? `${(group.totalDurationMs / 1000).toFixed(1)}s total` : ""}</span>
            {hasErrors && (
              <>
                <span className="text-[var(--text-tertiary)]">&middot;</span>
                <span className="text-[var(--color-error)] font-medium">{group.errorCount} error{group.errorCount !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Thread count */}
          {(() => {
            const threads = new Set(group.logs.map((l) => l.thread_id).filter(Boolean));
            return threads.size > 0 ? (
              <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
                {threads.size} thread{threads.size !== 1 ? "s" : ""}
              </span>
            ) : null;
          })()}
          <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
            {group.earliest ? timeAgo(group.earliest) : ""}
          </span>
          <Link
            to={`/kaira/logs?run_id=${group.runId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="View only this run's logs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </button>

      {/* Logs within group */}
      {!collapsed && (
        <div className="border-t border-[var(--border-subtle)]">
          <div className="space-y-px">
            {group.logs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                expanded={expandedLogId === log.id}
                onToggle={() => onToggleLog(log.id)}
                showRunId={false}
                nested
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Individual Log Row ─────────────────────────────────────────── */

function LogRow({
  log,
  expanded,
  onToggle,
  showRunId,
  nested = false,
}: {
  log: ApiLogEntry;
  expanded: boolean;
  onToggle: () => void;
  showRunId: boolean;
  nested?: boolean;
}) {
  const hasError = !!log.error;
  const borderColor = hasError ? "border-l-[var(--color-error)]" : "border-l-[var(--color-success)]";
  const outerClass = nested
    ? `border-l-[3px] ${borderColor}`
    : `bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md overflow-hidden border-l-[3px] ${borderColor}`;

  return (
    <div className={outerClass}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
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
          {showRunId && log.run_id && (
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
