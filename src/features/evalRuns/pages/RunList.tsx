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
      <div className="bg-red-50 border border-red-200 rounded p-3 text-[0.8rem] text-red-700">
        Failed to load runs: {error}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-slate-800">All Runs</h1>
        <div className="flex gap-1">
          {COMMANDS.map((cmd) => (
            <button
              key={cmd}
              onClick={() => setCommandFilter(cmd)}
              className={`px-2.5 py-1 text-[0.72rem] font-medium rounded transition-colors ${
                commandFilter === cmd
                  ? "bg-indigo-50 text-indigo-700"
                  : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-[0.8rem] text-slate-400 text-center py-8">Loading...</div>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <RunCard key={run.run_id} run={run} onDelete={handleDelete} />
          ))}
          {runs.length === 0 && (
            <p className="text-[0.8rem] text-slate-400 py-8 text-center">
              No runs found{commandFilter !== "all" ? ` for "${commandFilter}"` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
