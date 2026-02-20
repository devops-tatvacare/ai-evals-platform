import { useState, useEffect, useCallback, useMemo } from "react";
import { usePoll } from "@/hooks";
import { useSearchParams, useLocation, Link } from "react-router-dom";
import { runDetailForApp, apiLogsForApp } from "@/config/routes";
import { ExternalLink, X, Trash2, Tag } from "lucide-react";
import { ConfirmDialog, Badge, ModelBadge } from "@/components/ui";
import type { ApiLogEntry } from "@/types";
import { fetchLogs, fetchRun, deleteLogs } from "@/services/api/evalRunsApi";
import { timeAgo } from "@/utils/evalFormatters";
import {
  LogsPageShell,
  LogGroupCard,
  LogRowShell,
  CopyableCodeBlock,
  TokenDisplay,
} from "../components/logs";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "interrupted"];

interface RunGroup {
  runId: string;
  logs: ApiLogEntry[];
  earliest: string;
  latest: string;
  errorCount: number;
  totalDurationMs: number;
}

interface TestCaseGroup {
  label: string;
  logs: ApiLogEntry[];
  errorCount: number;
  totalDurationMs: number;
}

export default function Logs() {
  const location = useLocation();
  const appId = location.pathname.startsWith("/kaira") ? "kaira-bot" : "voice-rx";
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

  const load = useCallback(() => {
    setLoading(true);
    fetchLogs({ run_id: runIdFilter || undefined, app_id: appId, limit: 200 })
      .then((r) => {
        setLogs(r.logs);
        setError("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [runIdFilter, appId]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Check if the run is active on mount / filter change
  useEffect(() => {
    if (!runIdFilter) { setIsLive(false); return; }
    fetchRun(runIdFilter)
      .then((run) => setIsLive(!TERMINAL_STATUSES.includes(run.status.toLowerCase())))
      .catch(() => setIsLive(false));
  }, [runIdFilter]);

  // Poll logs + run status while run is live
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

  // Client-side search filter (matches run_id, thread_id, or test_case_label)
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (l.run_id && l.run_id.toLowerCase().includes(q)) ||
        (l.thread_id && l.thread_id.toLowerCase().includes(q)) ||
        (l.test_case_label && l.test_case_label.toLowerCase().includes(q))
    );
  }, [logs, searchQuery]);

  // BUG FIX #1: Group from filteredLogs (was [logs], now [filteredLogs])
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
  }, [filteredLogs]);

  // Sub-group logs by test_case_label when viewing a single run (adversarial)
  const testCaseGroups = useMemo((): TestCaseGroup[] | null => {
    if (!runIdFilter) return null;
    const hasLabels = filteredLogs.some((l) => !!l.test_case_label);
    if (!hasLabels) return null;

    const map = new Map<string, ApiLogEntry[]>();
    for (const log of filteredLogs) {
      const key = log.test_case_label || "Setup";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    const groups: TestCaseGroup[] = [];
    for (const [label, groupLogs] of map) {
      groups.push({
        label,
        logs: groupLogs,
        errorCount: groupLogs.filter((l) => !!l.error).length,
        totalDurationMs: groupLogs.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0),
      });
    }
    return groups;
  }, [filteredLogs, runIdFilter]);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deleteLogs(runIdFilter || undefined, appId);
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

  const collapseAll = () => {
    if (testCaseGroups) {
      setCollapsedRuns(new Set(testCaseGroups.map((g) => g.label)));
    } else {
      setCollapsedRuns(new Set(runGroups.map((g) => g.runId)));
    }
  };
  const expandAll = () => setCollapsedRuns(new Set());

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        {error}
      </div>
    );
  }

  const showGrouped = !runIdFilter && runGroups.length > 1;

  return (
    <>
      <LogsPageShell
        title="API Logs"
        totalCount={logs.length}
        filteredCount={filteredLogs.length}
        groupCount={showGrouped ? runGroups.length : undefined}
        isSearching={!!searchQuery.trim()}
        loading={loading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search by run ID, thread ID, or test case..."
        emptyTitle="No API logs found"
        emptyDescription={!runIdFilter ? "Run an evaluation to generate logs." : undefined}
        showExpandCollapseAll={showGrouped || !!testCaseGroups}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        isLive={isLive}
        headerActions={
          <>
            {runIdFilter && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-[var(--text-muted)]">Run:</span>
                <Link
                  to={runDetailForApp(appId, runIdFilter)}
                  className="font-mono text-[var(--text-brand)] hover:underline"
                >
                  {runIdFilter.slice(0, 12)}
                </Link>
                {/* BUG FIX #3: lucide X icon instead of literal "x" */}
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
              {runIdFilter ? "Delete Run Logs" : "Delete All Logs"}
            </button>
          </>
        }
      >
        {showGrouped ? (
          <div className="space-y-3">
            {runGroups.map((group) => (
              <RunGroupCard
                key={group.runId}
                group={group}
                appId={appId}
                collapsed={collapsedRuns.has(group.runId)}
                onToggleCollapse={() => toggleRunCollapse(group.runId)}
                expandedLogId={expandedId}
                onToggleLog={(id) => setExpandedId(expandedId === id ? null : id)}
              />
            ))}
          </div>
        ) : testCaseGroups ? (
          <div className="space-y-3">
            {testCaseGroups.map((tcGroup) => (
              <TestCaseGroupCard
                key={tcGroup.label}
                group={tcGroup}
                appId={appId}
                collapsed={collapsedRuns.has(tcGroup.label)}
                onToggleCollapse={() => toggleRunCollapse(tcGroup.label)}
                expandedLogId={expandedId}
                onToggleLog={(id) => setExpandedId(expandedId === id ? null : id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log) => (
              <LogRowItem
                key={log.id}
                log={log}
                appId={appId}
                expanded={expandedId === log.id}
                onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                showRunId={!runIdFilter}
              />
            ))}
          </div>
        )}
      </LogsPageShell>

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
    </>
  );
}

/* ── Run Group Card ─────────────────────────────────────────────── */

function RunGroupCard({
  group,
  appId,
  collapsed,
  onToggleCollapse,
  expandedLogId,
  onToggleLog,
}: {
  group: RunGroup;
  appId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedLogId: number | null;
  onToggleLog: (id: number) => void;
}) {
  const hasErrors = group.errorCount > 0;
  const primaryModel = group.logs[0]?.model;

  return (
    <LogGroupCard
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      headerLeft={
        <>
          <Link
            to={runDetailForApp(appId, group.runId)}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[13px] font-semibold text-[var(--text-brand)] hover:underline shrink-0"
          >
            {group.runId.slice(0, 12)}
          </Link>

          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
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

          {primaryModel && (
            <ModelBadge modelName={primaryModel} variant="inline" className="ml-1" />
          )}
        </>
      }
      headerRight={
        <>
          {(() => {
            const threads = new Set(group.logs.map((l) => l.thread_id).filter(Boolean));
            return threads.size > 0 ? (
              <span className="text-xs text-[var(--text-muted)]">
                {threads.size} thread{threads.size !== 1 ? "s" : ""}
              </span>
            ) : null;
          })()}
          <span className="text-xs text-[var(--text-muted)]">
            {group.earliest ? timeAgo(group.earliest) : ""}
          </span>
          {/* BUG FIX #2: <a target="_blank"> instead of <Link> (opens new tab) */}
          <a
            href={`${apiLogsForApp(appId)}?run_id=${group.runId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="View only this run's logs"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </>
      }
    >
      {group.logs.map((log) => (
        <LogRowItem
          key={log.id}
          log={log}
          appId={appId}
          expanded={expandedLogId === log.id}
          onToggle={() => onToggleLog(log.id)}
          showRunId={false}
          nested
        />
      ))}
    </LogGroupCard>
  );
}

/* ── Test Case Group Card (adversarial sub-grouping) ───────────── */

function TestCaseGroupCard({
  group,
  appId,
  collapsed,
  onToggleCollapse,
  expandedLogId,
  onToggleLog,
}: {
  group: TestCaseGroup;
  appId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  expandedLogId: number | null;
  onToggleLog: (id: number) => void;
}) {
  const hasErrors = group.errorCount > 0;

  return (
    <LogGroupCard
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      headerLeft={
        <>
          <div className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-[var(--text-brand)]" />
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              {group.label}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{group.logs.length} call{group.logs.length !== 1 ? "s" : ""}</span>
            <span className="text-[var(--text-tertiary)]">&middot;</span>
            <span>{group.totalDurationMs > 0 ? `${(group.totalDurationMs / 1000).toFixed(1)}s` : ""}</span>
            {hasErrors && (
              <>
                <span className="text-[var(--text-tertiary)]">&middot;</span>
                <span className="text-[var(--color-error)] font-medium">{group.errorCount} error{group.errorCount !== 1 ? "s" : ""}</span>
              </>
            )}
          </div>
        </>
      }
      headerRight={null}
    >
      {group.logs.map((log) => (
        <LogRowItem
          key={log.id}
          log={log}
          appId={appId}
          expanded={expandedLogId === log.id}
          onToggle={() => onToggleLog(log.id)}
          showRunId={false}
          nested
        />
      ))}
    </LogGroupCard>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

function cleanPromptPreview(prompt: string, method: string): string {
  if (method === "stream_message") {
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.query) return String(parsed.query);
      if (parsed.message) return String(parsed.message);
    } catch { /* fallback to raw */ }
  }
  return prompt
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[-*+]\s/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/* ── Individual Log Row ─────────────────────────────────────────── */

function LogRowItem({
  log,
  appId,
  expanded,
  onToggle,
  showRunId,
  nested = false,
}: {
  log: ApiLogEntry;
  appId: string;
  expanded: boolean;
  onToggle: () => void;
  showRunId: boolean;
  nested?: boolean;
}) {
  const hasError = !!log.error;
  const cleanPrompt = cleanPromptPreview(log.prompt, log.method);
  const methodLabel = log.method === "generate_json" ? "JSON" : log.method === "stream_message" ? "API" : "TEXT";
  const methodVariant = log.method === "generate_json" ? "info" : log.method === "stream_message" ? "warning" : "primary";

  return (
    <LogRowShell
      expanded={expanded}
      onToggle={onToggle}
      nested={nested}
      accentColor={hasError ? 'error' : 'success'}
      summaryLeft={
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Badge
              variant={methodVariant as any}
              size="sm"
              className="shrink-0 uppercase text-[0.6rem] font-bold"
            >
              {methodLabel}
            </Badge>
            <span className="text-[13px] text-[var(--text-primary)] truncate">
              {cleanPrompt.length > 90 ? `${cleanPrompt.slice(0, 90)}…` : cleanPrompt}
            </span>
          </div>
          <div className="flex items-center gap-2 pl-0.5">
            {log.duration_ms != null && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {formatDuration(log.duration_ms)}
              </span>
            )}
            <ModelBadge modelName={log.model} variant="inline" />
            <span className="text-[11px] text-[var(--text-muted)]">
              {timeAgo(log.created_at)}
            </span>
            {log.thread_id && (
              <>
                <span className="text-[11px] text-[var(--text-tertiary)]">&middot;</span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]">
                  {log.thread_id.slice(0, 15)}
                </span>
              </>
            )}
            {showRunId && log.run_id && (
              <>
                <span className="text-[11px] text-[var(--text-tertiary)]">&middot;</span>
                <Link
                  to={runDetailForApp(appId, log.run_id)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] font-mono text-[var(--text-brand)] hover:underline"
                >
                  {log.run_id.slice(0, 8)}
                </Link>
              </>
            )}
          </div>
        </>
      }
      summaryRight={null}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-[var(--text-muted)]">Provider</span>
          <p className="font-medium text-[var(--text-primary)]">{log.provider}</p>
        </div>
        <div>
          <span className="text-[var(--text-muted)]">Model</span>
          <div className="font-medium text-[var(--text-primary)]">
            <ModelBadge modelName={log.model} variant="inline" />
          </div>
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

      {/* Token display */}
      {(log.tokens_in != null || log.tokens_out != null) && (
        <div className="text-xs">
          <span className="text-[var(--text-muted)]">Tokens: </span>
          <TokenDisplay tokensIn={log.tokens_in} tokensOut={log.tokens_out} />
        </div>
      )}

      {log.thread_id && (
        <div className="text-xs">
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
        <CopyableCodeBlock
          content={log.system_prompt}
          label="System Prompt"
          labelColor="var(--text-muted)"
          maxHeight="max-h-48"
        />
      )}

      <CopyableCodeBlock
        content={log.prompt}
        label="Prompt"
        labelColor="var(--text-muted)"
      />

      {log.response && (
        <CopyableCodeBlock
          content={formatResponse(log.response)}
          label="Response"
          labelColor="var(--color-success)"
          variant="success"
        />
      )}

      {log.error && (
        <CopyableCodeBlock
          content={log.error}
          label="Error"
          labelColor="var(--color-error)"
          variant="error"
        />
      )}
    </LogRowShell>
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
