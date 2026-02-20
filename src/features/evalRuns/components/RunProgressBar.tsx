import { Clock } from 'lucide-react';
import type { Job } from '@/services/api/jobsApi';

interface ProgressState {
  current: number;
  total: number;
  message: string;
}

export function RunProgressBar({
  job,
  elapsed,
}: {
  job: Job | null;
  elapsed: string;
}) {
  if (!job) return null;

  const isQueued = job.status === "queued";
  const isRunning = job.status === "running";
  const isCompleted = job.status === "completed";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";

  const progress = job.progress as ProgressState | undefined;
  const pctValue =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  if (isCompleted || isFailed || isCancelled) return null;

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isQueued && (
            <>
              <Clock className="h-4 w-4 text-[var(--color-warning)] animate-pulse" />
              <span className="text-sm font-semibold text-[var(--color-warning)]">
                Queued
              </span>
            </>
          )}
          {isRunning && (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-info)] opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-info)]" />
              </span>
              <span className="text-sm font-semibold text-[var(--color-info)]">
                Running
              </span>
            </>
          )}
          {progress?.message && (
            <span className="text-sm text-[var(--text-secondary)]">
              {progress.message}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
          {elapsed && <span>{elapsed} elapsed</span>}
          {isRunning && progress && progress.total > 0 && (
            <span>{progress.current}/{progress.total}</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        {isQueued && (
          <div className="h-full bg-[var(--color-warning)] rounded-full w-full animate-pulse opacity-30" />
        )}
        {isRunning && progress && progress.total > 0 && (
          <div
            className="h-full bg-[var(--color-info)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pctValue}%` }}
          />
        )}
        {isRunning && (!progress || progress.total === 0) && (
          <div className="h-full bg-[var(--color-info)] rounded-full w-full animate-pulse opacity-40" />
        )}
      </div>

      {isQueued && (
        <p className="text-xs text-[var(--text-muted)]">
          Waiting for worker to pick up this job...
        </p>
      )}
    </div>
  );
}
