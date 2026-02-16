import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2, XCircle, Clock, MessageSquare, Cpu } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import type { Run } from "@/types";
import { jobsApi } from "@/services/api/jobsApi";
import VerdictBadge from "./VerdictBadge";
import { timeAgo, formatDuration, humanize } from "@/utils/evalFormatters";

interface Props {
  run: Run;
  onDelete?: (runId: string) => void;
}

export default function RunCard({ run, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cancellingCard, setCancellingCard] = useState(false);
  const summary = run.summary ?? {};
  const totalItems =
    (summary.total_threads as number) ??
    (summary.total_tests as number) ??
    run.total_items ??
    0;
  const itemLabel = run.command === "adversarial" ? "tests" : "threads";
  const isActive = run.status.toLowerCase() === "running";

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete) return;
    setConfirmDelete(true);
  }

  function handleDeleteConfirm() {
    if (!onDelete) return;
    setDeleting(true);
    setConfirmDelete(false);
    onDelete(run.run_id);
  }

  async function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!run.job_id) return;
    setCancellingCard(true);
    try {
      await jobsApi.cancel(run.job_id);
    } catch {
      // Cancel failed silently — polling will show real status
    } finally {
      setCancellingCard(false);
    }
  }

  return (
    <>
      <Link
        to={`/kaira/runs/${run.run_id}`}
        className="block bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-3.5 py-2.5 hover:border-[var(--border-focus)] transition-colors group"
      >
        {/* Row 1: Name + status + actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <VerdictBadge verdict={run.status} category="status" />
            <span className="font-semibold text-[13px] text-[var(--text-primary)] truncate">
              {run.name || humanize(run.command)}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isActive && run.job_id && (
              <button
                onClick={handleCancel}
                disabled={cancellingCard}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--color-warning)] hover:bg-[var(--surface-warning)] rounded transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                title="Cancel run"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={handleDeleteClick}
                disabled={deleting || isActive}
                className="p-1 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] hover:bg-[var(--surface-error)] rounded transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]"
                title={isActive ? "Cancel the run before deleting" : "Delete run"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Metadata */}
        <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--text-muted)]">
          <span className="font-mono">{run.run_id.slice(0, 8)}</span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {totalItems} {itemLabel}
          </span>
          {(summary.errors as number) > 0 && (
            <span className="text-[var(--color-error)] font-medium">
              ({summary.errors as number} failed)
            </span>
          )}
          {run.llm_model && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {run.llm_model}
            </span>
          )}
          {run.duration_seconds > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(run.duration_seconds)}
            </span>
          )}
          <span className="ml-auto">{timeAgo(run.timestamp)}</span>
        </div>
      </Link>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Evaluation Run"
        description={`Delete run ${run.run_id.slice(0, 12)}... and all its evaluations? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}
