import { useState, useEffect, useCallback, useMemo } from "react";
import { FileSpreadsheet, ShieldAlert, FlaskConical, Search } from "lucide-react";
import type { Run, EvalRun } from "@/types";
import { fetchRuns, deleteRun, fetchEvalRuns, deleteEvalRun } from "@/services/api/evalRunsApi";
import { RunCard, RunRowCard, NewBatchEvalOverlay, NewAdversarialOverlay } from "../components";
import { SplitButton, EmptyState, ConfirmDialog } from "@/components/ui";
import { TAG_ACCENT_COLORS } from "@/utils/statusColors";
import { timeAgo, formatDuration } from "@/utils/evalFormatters";

const COMMANDS = ["all", "evaluate-thread", "evaluate-batch", "adversarial", "custom-evaluators"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// --- EvalRun helpers ---

function getRunName(run: EvalRun): string {
  const s = run.summary as Record<string, unknown> | undefined;
  const c = run.config as Record<string, unknown> | undefined;
  return (s?.evaluator_name as string) ?? (c?.evaluator_name as string) ?? run.evalType ?? 'Unknown';
}

function getRunScore(run: EvalRun): { value: string; color: string } {
  const s = run.summary as Record<string, unknown> | undefined;
  if (!s) return { value: '--', color: 'var(--text-muted)' };
  for (const [, v] of Object.entries(s)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) {
      return {
        value: `${(v * 100).toFixed(0)}%`,
        color: v >= 0.7 ? 'var(--color-success)' : v >= 0.4 ? 'var(--color-warning)' : 'var(--color-error)',
      };
    }
  }
  return { value: '--', color: 'var(--text-muted)' };
}

function mapEvalRunStatus(status: EvalRun['status']): string {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'error';
    case 'completed_with_errors': return 'error';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'cancelled': return 'cancelled';
    default: return status;
  }
}

type UnifiedItem =
  | { _kind: 'batch'; ts: number; data: Run }
  | { _kind: 'custom'; ts: number; data: EvalRun };

export default function RunList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [commandFilter, setCommandFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBatchWizard, setShowBatchWizard] = useState(false);
  const [showAdversarialWizard, setShowAdversarialWizard] = useState(false);

  const [customRuns, setCustomRuns] = useState<EvalRun[]>([]);
  const [customEvalFilter, setCustomEvalFilter] = useState('all');
  const [customStatusFilter, setCustomStatusFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<EvalRun | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isCustomTab = commandFilter === "custom-evaluators";
  const isAllTab = commandFilter === "all";

  const loadRuns = useCallback(() => {
    setLoading(true);
    setError("");
    if (isAllTab) {
      Promise.all([
        fetchRuns({ limit: 100 }).then((r) => r.runs).catch(() => [] as Run[]),
        fetchEvalRuns({ app_id: 'kaira-bot', eval_type: 'custom', limit: 200 }).catch(() => [] as EvalRun[]),
      ])
        .then(([batchRuns, customRunsResult]) => {
          setRuns(batchRuns);
          setCustomRuns(customRunsResult);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else if (isCustomTab) {
      fetchEvalRuns({ app_id: 'kaira-bot', eval_type: 'custom', limit: 200 })
        .then(setCustomRuns)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      fetchRuns({ command: commandFilter, limit: 100 })
        .then((r) => { setRuns(r.runs); setLoading(false); })
        .catch((e: Error) => { setError(e.message); setLoading(false); });
    }
  }, [commandFilter, isCustomTab, isAllTab]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleDelete = useCallback(async (runId: string) => {
    try {
      await deleteRun(runId);
      setRuns((prev) => prev.filter((r) => r.run_id !== runId));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const handleDeleteCustom = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteEvalRun(deleteTarget.id);
      setCustomRuns((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  const evaluatorNames = useMemo(() => {
    const names = new Set(customRuns.map((r) => getRunName(r)));
    return Array.from(names).sort();
  }, [customRuns]);

  const filteredCustomRuns = useMemo(() => {
    let result = customRuns;
    if (customEvalFilter !== 'all') result = result.filter((r) => getRunName(r) === customEvalFilter);
    if (customStatusFilter !== 'all') {
      result = result.filter((r) => {
        if (customStatusFilter === 'success') return r.status === 'completed';
        if (customStatusFilter === 'error') return r.status === 'failed' || r.status === 'completed_with_errors';
        return true;
      });
    }
    return result;
  }, [customRuns, customEvalFilter, customStatusFilter]);

  const unifiedItems = useMemo((): UnifiedItem[] => {
    if (!isAllTab) return [];
    // Collect custom run IDs so we can deduplicate — fetchRuns() returns ALL
    // types including custom, which would duplicate the customRuns entries.
    const customRunIds = new Set(customRuns.map((r) => r.id));
    const items: UnifiedItem[] = [
      ...runs
        .filter((r) => !customRunIds.has(r.run_id))
        .map((r): UnifiedItem => ({ _kind: 'batch', ts: new Date(r.timestamp).getTime(), data: r })),
      ...customRuns.map((r): UnifiedItem => ({ _kind: 'custom', ts: new Date(r.createdAt).getTime(), data: r })),
    ];
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [isAllTab, runs, customRuns]);

  if (error) {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded p-3 text-sm text-[var(--color-error)]">
        Failed to load runs: {error}
      </div>
    );
  }

  function renderCustomRow(run: EvalRun) {
    const name = getRunName(run);
    const color = TAG_ACCENT_COLORS[hashString(name) % TAG_ACCENT_COLORS.length];
    const { value: score, color: sColor } = getRunScore(run);
    return (
      <RunRowCard
        key={run.id}
        to={`/kaira/logs?entity_id=${run.id}`}
        status={mapEvalRunStatus(run.status)}
        title={name}
        titleColor={color}
        score={score}
        scoreColor={sColor}
        id={run.id.slice(0, 8)}
        metadata={[
          ...(run.sessionId ? [{ text: run.sessionId.slice(0, 8) }] : []),
          { text: run.evalType },
          { text: run.durationMs ? formatDuration(run.durationMs / 1000) : '--' },
        ]}
        timeAgo={run.createdAt ? timeAgo(new Date(run.createdAt).toISOString()) : ''}
        onDelete={() => setDeleteTarget(run)}
      />
    );
  }

  return (
    <div className="space-y-3 flex-1 flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-base font-bold text-[var(--text-primary)]">All Runs</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 flex-wrap">
            {COMMANDS.map((cmd) => (
              <button
                key={cmd}
                onClick={() => setCommandFilter(cmd)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
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

      {/* Sub-filters for custom evaluator tab */}
      {isCustomTab && !loading && customRuns.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {['all', ...evaluatorNames].map((name) => (
              <button
                key={name}
                onClick={() => setCustomEvalFilter(name)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  customEvalFilter === name
                    ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                    : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {name === 'all' ? 'All' : name}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['all', 'success', 'error'].map((st) => (
              <button
                key={st}
                onClick={() => setCustomStatusFilter(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] ${
                  customStatusFilter === st
                    ? 'bg-[var(--surface-info)] text-[var(--color-info)]'
                    : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {st === 'all' ? 'Any status' : st}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 min-h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Loading...</div>
      ) : isAllTab ? (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {unifiedItems.map((item) =>
            item._kind === 'batch'
              ? <RunCard key={item.data.run_id} run={item.data} onDelete={handleDelete} />
              : renderCustomRow(item.data),
          )}
          {unifiedItems.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={FlaskConical}
                title="No runs found"
                description="Start a batch evaluation, adversarial test, or run a custom evaluator to see results here."
              />
            </div>
          )}
        </div>
      ) : isCustomTab ? (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {filteredCustomRuns.map(renderCustomRow)}
          {filteredCustomRuns.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={customEvalFilter !== 'all' || customStatusFilter !== 'all' ? Search : FlaskConical}
                title={customEvalFilter !== 'all' || customStatusFilter !== 'all' ? 'No matching runs' : 'No custom evaluator runs yet'}
                description={customEvalFilter !== 'all' || customStatusFilter !== 'all'
                  ? 'Try changing the filters to see more results.'
                  : 'Run a custom evaluator on a Kaira Bot session to see results here.'}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5 flex-1 flex flex-col">
          {runs.map((run) => (
            <RunCard key={run.run_id} run={run} onDelete={handleDelete} />
          ))}
          {runs.length === 0 && (
            <div className="flex-1 min-h-full flex items-center justify-center">
              <EmptyState
                icon={FlaskConical}
                title={`No runs found for "${commandFilter}"`}
                description="Start a batch evaluation or adversarial test to see runs here."
              />
            </div>
          )}
        </div>
      )}

      {showBatchWizard && <NewBatchEvalOverlay onClose={() => setShowBatchWizard(false)} />}
      {showAdversarialWizard && <NewAdversarialOverlay onClose={() => setShowAdversarialWizard(false)} />}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteCustom}
        title="Delete Run"
        description={`Delete this evaluator run (${deleteTarget ? getRunName(deleteTarget) : ''})? This cannot be undone.`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
