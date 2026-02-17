import { useState, useEffect, useCallback } from "react";
import { FileSpreadsheet, ShieldAlert, FlaskConical } from "lucide-react";
import type { Run } from "@/types";
import { fetchRuns, deleteRun } from "@/services/api/evalRunsApi";
import { RunCard, NewBatchEvalOverlay, NewAdversarialOverlay } from "../components";
import { SplitButton, EmptyState } from "@/components/ui";

const COMMANDS = ["all", "evaluate-thread", "evaluate-batch", "adversarial"];

export default function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [commandFilter, setCommandFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBatchWizard, setShowBatchWizard] = useState(false);
  const [showAdversarialWizard, setShowAdversarialWizard] = useState(false);

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
    <div className="space-y-3 flex-1 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>
        <div className="flex items-center gap-2">
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
          <SplitButton
            primaryLabel="Batch Evaluation"
            primaryIcon={<FileSpreadsheet className="h-4 w-4" />}
            primaryAction={() => setShowBatchWizard(true)}
            size="sm"
            dropdownItems={[
              {
                label: 'Batch Evaluation',
                icon: <FileSpreadsheet className="h-4 w-4" />,
                description: 'Evaluate conversation threads from CSV data',
                action: () => setShowBatchWizard(true),
              },
              {
                label: 'Adversarial Stress Test',
                icon: <ShieldAlert className="h-4 w-4" />,
                description: 'Run adversarial inputs against live Kaira API',
                action: () => setShowAdversarialWizard(true),
              },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-[0.8rem] text-[var(--text-muted)]">Loading...</div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {runs.map((run) => (
            <RunCard key={run.run_id} run={run} onDelete={handleDelete} />
          ))}
          {runs.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={FlaskConical}
                title={`No runs found${commandFilter !== "all" ? ` for "${commandFilter}"` : ""}`}
                description="Start a batch evaluation or adversarial test to see runs here."
              />
            </div>
          )}
        </div>
      )}

      {showBatchWizard && <NewBatchEvalOverlay onClose={() => setShowBatchWizard(false)} />}
      {showAdversarialWizard && <NewAdversarialOverlay onClose={() => setShowAdversarialWizard(false)} />}
    </div>
  );
}
