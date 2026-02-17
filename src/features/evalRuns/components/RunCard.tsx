import { useState } from "react";
import { MessageSquare, Cpu } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import type { Run } from "@/types";
import { jobsApi } from "@/services/api/jobsApi";
import RunRowCard from "./RunRowCard";
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

  function handleDeleteConfirm() {
    if (!onDelete) return;
    setDeleting(true);
    setConfirmDelete(false);
    onDelete(run.run_id);
  }

  async function handleCancel() {
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

  const metadata = [
    { icon: <MessageSquare className="h-3 w-3" />, text: `${totalItems} ${itemLabel}` },
    ...((summary.errors as number) > 0
      ? [{ text: `(${summary.errors as number} failed)` }]
      : []),
    ...(run.llm_model
      ? [{ icon: <Cpu className="h-3 w-3" />, text: run.llm_model }]
      : []),
    ...(run.duration_seconds > 0
      ? [{ text: formatDuration(run.duration_seconds) }]
      : []),
  ];

  return (
    <>
      <RunRowCard
        to={`/kaira/runs/${run.run_id}`}
        status={run.status}
        title={run.name || humanize(run.command)}
        id={run.run_id.slice(0, 8)}
        metadata={metadata}
        timeAgo={timeAgo(run.timestamp)}
        isRunning={isActive}
        onCancel={isActive && run.job_id ? handleCancel : undefined}
        cancelDisabled={cancellingCard}
        onDelete={onDelete ? () => setConfirmDelete(true) : undefined}
        deleteDisabled={deleting || isActive}
      />

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
