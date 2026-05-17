import { AlertTriangle, Ban, Loader2, XCircle } from 'lucide-react';
import {
  isActive,
  isReviewable,
  normalizeRunStatus,
  type AnyRunStatus,
} from '@/utils/runLifecycle';

interface Props {
  status: AnyRunStatus;
  errorMessage?: string | null;
  /**
   * Optional sub-heading rendered above the error message for the `failed`
   * variant — e.g. "Failed during transcription". Falls back to a generic
   * label when absent.
   */
  failureHeadline?: string;
}

/**
 * Status banner for the run-detail surface. Renders nothing on reviewable
 * (completed / completed_with_errors) runs — the happy path needs no banner.
 *
 * Variants:
 *   - failed     red, error-icon, error message + optional headline
 *   - cancelled  amber, ban-icon
 *   - active     info, spinner — opt-in via `showActive`
 *   - other      nothing
 */
export function RunStatusBanner({
  status,
  errorMessage,
  failureHeadline,
}: Props) {
  if (isReviewable(status)) return null;

  const normalized = normalizeRunStatus(status);

  if (normalized === 'failed') {
    return (
      <div className="bg-[var(--surface-error)] border border-[var(--border-error)] rounded-md px-4 py-2.5">
        <div className="flex items-center gap-2 text-[var(--color-error)]">
          <XCircle className="h-4 w-4 shrink-0" />
          <strong className="text-sm font-medium">
            {failureHeadline ?? 'Run failed'}
          </strong>
        </div>
        {errorMessage && (
          <p className="mt-1 text-xs text-[var(--color-error)]" style={{ opacity: 0.85 }}>
            {errorMessage}
          </p>
        )}
      </div>
    );
  }

  if (normalized === 'cancelled') {
    return (
      <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
        <Ban className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
        <span className="text-sm text-[var(--color-warning)] font-medium">
          Run cancelled. Partial results may be shown below.
        </span>
      </div>
    );
  }

  if (normalized === 'interrupted') {
    return (
      <div className="bg-[var(--surface-warning)] border border-[var(--border-warning)] rounded-md px-4 py-2.5 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
        <span className="text-sm text-[var(--color-warning)] font-medium">
          Run interrupted before completion.
        </span>
      </div>
    );
  }

  if (isActive(status)) {
    return (
      <div className="bg-[var(--surface-info)] border border-[var(--border-info)] rounded-md px-4 py-2.5 flex items-center gap-2">
        <Loader2 className="h-4 w-4 text-[var(--color-info)] shrink-0 animate-spin" />
        <span className="text-sm text-[var(--color-info)] font-medium">
          Run in progress…
        </span>
      </div>
    );
  }

  return null;
}
