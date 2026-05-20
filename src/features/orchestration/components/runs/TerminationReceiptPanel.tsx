import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui';
import type { CancelOutcome, WorkflowRun } from '@/features/orchestration/types';
import { useRunCancelAudits } from '@/features/orchestration/queries/runs';

// Bound the poll so a no-op finalize (nothing in flight → zero audit rows)
// doesn't refetch forever. Finalize is a priority job; 60 s is generous.
const POLL_BUDGET_MS = 60_000;

const OUTCOME_LABELS: Record<CancelOutcome, string> = {
  stopped: 'Stopped',
  cancelled: 'Cancelled',
  noop_unsupported: 'Not supported',
  noop_already_delivered: 'Already delivered',
  noop_already_terminal: 'Already finished',
  provider_error: 'Failed',
};

const OUTCOME_VARIANTS: Record<CancelOutcome, BadgeVariant> = {
  stopped: 'success',
  cancelled: 'success',
  noop_unsupported: 'neutral',
  noop_already_delivered: 'neutral',
  noop_already_terminal: 'neutral',
  provider_error: 'error',
};

interface Props {
  run: WorkflowRun;
}

/** Per-provider cancel outcomes for a stopped run (D5: audit rows appearing
 *  means the async finalize job ran). Polls until the first batch lands, then
 *  settles. Renders only for cancelled runs. */
export function TerminationReceiptPanel({ run }: Props) {
  const isCancelled = run.status === 'cancelled';
  const [pollExpired, setPollExpired] = useState(false);

  // Mounted per run (keyed on run.id by the inspector), so the budget starts
  // fresh each time; the timer's setState fires in a callback, not synchronously.
  useEffect(() => {
    if (!isCancelled) return;
    const timer = setTimeout(() => setPollExpired(true), POLL_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [isCancelled]);

  const auditsQuery = useRunCancelAudits(run.id, {
    enabled: isCancelled,
    poll: isCancelled && !pollExpired,
  });

  if (!isCancelled) return null;

  const audits = auditsQuery.data ?? [];
  const stillWaiting = audits.length === 0 && !pollExpired;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Cancellation results
      </p>
      {stillWaiting ? (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Confirming provider cancellations…
        </span>
      ) : audits.length === 0 ? (
        <p className="text-[12px] text-[var(--text-secondary)]">
          No in-flight provider calls needed cancelling.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {audits.map((audit) => (
            <li key={audit.id} className="flex items-center gap-2 text-[12px]">
              <Badge variant={OUTCOME_VARIANTS[audit.outcome]}>
                {OUTCOME_LABELS[audit.outcome]}
              </Badge>
              {audit.providerMessage ? (
                <span className="truncate text-[var(--text-muted)]">
                  {audit.providerMessage}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
