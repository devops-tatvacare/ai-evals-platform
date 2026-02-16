import { useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { Run } from "@/types";
import VerdictBadge from "./VerdictBadge";
import { timeAgo, formatDuration } from "@/utils/evalFormatters";

interface Props {
  run: Run;
  onDelete?: (runId: string) => void;
}

export default function RunCard({ run, onDelete }: Props) {
  const [deleting, setDeleting] = useState(false);
  const summary = run.summary ?? {};
  const totalItems =
    (summary.total_threads as number) ??
    (summary.total_tests as number) ??
    run.total_items ??
    0;
  const itemLabel = run.command === "adversarial" ? "tests" : "threads";

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete) return;
    if (!window.confirm(`Delete run ${run.run_id.slice(0, 12)}… and all its evaluations?`)) return;
    setDeleting(true);
    onDelete(run.run_id);
  }

  return (
    <Link
      to={`/kaira/runs/${run.run_id}`}
      className="flex items-center justify-between gap-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-3 py-2.5 hover:border-[var(--border-focus)] transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[var(--text-xs)] font-mono text-[var(--text-muted)] shrink-0">
          {run.run_id.slice(0, 8)}
        </span>
        <span className="font-semibold text-[0.82rem] text-[var(--text-primary)]">
          {run.command}
        </span>
        <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
          {totalItems} {itemLabel}
        </span>
        {run.llm_model && (
          <span className="text-[var(--text-xs)] text-[var(--text-muted)] hidden md:inline" style={{ opacity: 0.6 }}>
            {run.llm_provider}/{run.llm_model}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[var(--text-xs)] text-[var(--text-muted)]">
          {formatDuration(run.duration_seconds)}
        </span>
        <span className="text-[var(--text-xs)] text-[var(--text-muted)]">{timeAgo(run.timestamp)}</span>
        <VerdictBadge verdict={run.status} category="status" />
        {onDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--surface-error)] rounded transition-colors disabled:opacity-50"
            title="Delete run"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </Link>
  );
}
