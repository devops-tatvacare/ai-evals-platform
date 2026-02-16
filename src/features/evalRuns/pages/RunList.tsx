import { useState, useEffect, useCallback } from "react";
import type { Run } from "@/types";
import { fetchRuns, deleteRun } from "@/services/api/evalRunsApi";
import { RunCard } from "../components";

const COMMANDS = ["all", "evaluate-thread", "evaluate-batch", "adversarial"];

export default function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [commandFilter, setCommandFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadRuns = useCallback(() => {
    setLoading(true);
    const command = commandFilter === "all" ? undefined : commandFilter;
    fetchRuns({ command, limit: 100 })
      .then((r) => {
        setRuns(r.runs);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [commandFilter]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleDelete = useCallback(async (runId: string) => {
    try {
      await deleteRun(runId);
      setRuns((prev) => prev.filter((r) => r.run_id !== runId));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-[0.8rem] text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>
        <div className="flex gap-1">
          {COMMANDS.map((cmd) => (
            <button
              key={cmd}
              onClick={() => setCommandFilter(cmd)}
              className={`px-2.5 py-1 text-[var(--text-xs)] font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                commandFilter === cmd
                  ? "bg-[var(--surface-info)] text-[var(--color-info)]"
                  : "bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-[0.8rem] text-[var(--text-muted)] text-center py-8">Loading...</div>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <RunCard key={run.run_id} run={run} onDelete={handleDelete} />
          ))}
          {runs.length === 0 && (
            <p className="text-[0.8rem] text-[var(--text-muted)] py-8 text-center">
              No runs found{commandFilter !== "all" ? ` for "${commandFilter}"` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
