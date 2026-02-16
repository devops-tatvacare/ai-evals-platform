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
      <div className="bg-red-50 border border-red-200 rounded p-3 text-[0.8rem] text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold text-slate-800">API Logs</h1>
          <span className="text-[0.72rem] text-slate-400">
            {logs.length} entries
          </span>
        </div>
        <div className="flex items-center gap-2">
          {runIdFilter && (
            <div className="flex items-center gap-1.5 text-[0.72rem]">
              <span className="text-slate-400">Run:</span>
              <Link
                to={`/kaira/runs/${runIdFilter}`}
                className="font-mono text-indigo-600 hover:underline"
              >
                {runIdFilter.slice(0, 12)}
              </Link>
              <button
                onClick={handleClearFilter}
                className="text-slate-400 hover:text-slate-600 ml-1"
                title="Clear filter"
              >
                x
              </button>
            </div>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting || logs.length === 0}
            className="px-2.5 py-1 text-[0.72rem] font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting..." : runIdFilter ? "Delete Run Logs" : "Delete All Logs"}
          </button>
        </div>
      </div>

      {runIdFilter && threadIds.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[0.68rem] uppercase tracking-wider text-slate-400 font-semibold">
            Threads:
          </span>
          {threadIds.map((tid) => (
            <span
              key={tid}
              className="px-1.5 py-0.5 rounded text-[0.68rem] font-mono bg-slate-100 text-slate-600"
            >
              {tid!.slice(0, 20)}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-[0.8rem] text-slate-400 text-center py-8">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-[0.8rem] text-slate-400 text-center py-8">
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
  const borderColor = hasError ? "border-l-red-400" : "border-l-emerald-400";

  return (
    <div className={`bg-white border border-slate-200 rounded-md overflow-hidden border-l-[3px] ${borderColor}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`shrink-0 px-1.5 py-px rounded text-[0.6rem] font-bold uppercase ${
              log.method === "generate_json"
                ? "bg-violet-500 text-white"
                : "bg-blue-500 text-white"
            }`}
          >
            {log.method === "generate_json" ? "JSON" : "TEXT"}
          </span>
          <span className="text-[0.74rem] font-medium text-slate-700 truncate">
            {log.prompt.slice(0, 80)}{log.prompt.length > 80 ? "..." : ""}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {log.thread_id && (
            <span className="text-[0.66rem] font-mono text-slate-400 hidden md:inline">
              {log.thread_id.slice(0, 15)}
            </span>
          )}
          {showRunId && (
            <Link
              to={`/kaira/runs/${log.run_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[0.66rem] font-mono text-indigo-500 hover:underline hidden md:inline"
            >
              {log.run_id.slice(0, 8)}
            </Link>
          )}
          <span className="text-[0.68rem] text-slate-400">
            {log.duration_ms != null ? `${log.duration_ms.toFixed(0)}ms` : ""}
          </span>
          <span className="text-[0.68rem] text-slate-300">
            {log.model}
          </span>
          <span className="text-[0.68rem] text-slate-400">
            {timeAgo(log.created_at)}
          </span>
          <span className="text-[0.68rem] text-slate-300">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-3 py-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[0.72rem]">
            <div>
              <span className="text-slate-400">Provider</span>
              <p className="font-medium text-slate-700">{log.provider}</p>
            </div>
            <div>
              <span className="text-slate-400">Model</span>
              <p className="font-medium text-slate-700">{log.model}</p>
            </div>
            <div>
              <span className="text-slate-400">Method</span>
              <p className="font-medium text-slate-700">{log.method}</p>
            </div>
            <div>
              <span className="text-slate-400">Duration</span>
              <p className="font-medium text-slate-700">
                {log.duration_ms != null ? `${log.duration_ms.toFixed(1)}ms` : "\u2014"}
              </p>
            </div>
          </div>

          {log.thread_id && (
            <div className="text-[0.72rem]">
              <span className="text-slate-400">Thread ID: </span>
              <Link
                to={`/kaira/threads/${log.thread_id}`}
                className="font-mono text-indigo-600 hover:underline"
              >
                {log.thread_id}
              </Link>
            </div>
          )}

          {log.system_prompt && (
            <div>
              <p className="text-[0.68rem] uppercase tracking-wider text-slate-400 font-semibold mb-1">
                System Prompt
              </p>
              <pre className="bg-slate-50 border border-slate-200 rounded p-2.5 text-[0.7rem] text-slate-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {log.system_prompt}
              </pre>
            </div>
          )}

          <div>
            <p className="text-[0.68rem] uppercase tracking-wider text-slate-400 font-semibold mb-1">
              Prompt
            </p>
            <pre className="bg-slate-50 border border-slate-200 rounded p-2.5 text-[0.7rem] text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {log.prompt}
            </pre>
          </div>

          {log.response && (
            <div>
              <p className="text-[0.68rem] uppercase tracking-wider text-emerald-500 font-semibold mb-1">
                Response
              </p>
              <pre className="bg-emerald-50 border border-emerald-200 rounded p-2.5 text-[0.7rem] text-slate-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {formatResponse(log.response)}
              </pre>
            </div>
          )}

          {log.error && (
            <div>
              <p className="text-[0.68rem] uppercase tracking-wider text-red-500 font-semibold mb-1">
                Error
              </p>
              <pre className="bg-red-50 border border-red-200 rounded p-2.5 text-[0.7rem] text-red-700 whitespace-pre-wrap">
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
