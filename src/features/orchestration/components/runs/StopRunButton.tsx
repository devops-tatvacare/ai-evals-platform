import { useState } from 'react';
import { CircleStop } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';
import { notificationService } from '@/services/notifications';
import {
  decodeApiError,
  summarizeApiErrorBody,
} from '@/features/orchestration/contracts/errorDecoder';
import { isRunActive, type WorkflowRun } from '@/features/orchestration/types';
import { useCancelRun, useRunRecipients } from '@/features/orchestration/queries/runs';

// Recipient states the waiting-tail can still sit in after the run itself
// completes — their presence means Stop still has work to do.
const NON_TERMINAL_RECIPIENT_STATUSES = new Set(['pending', 'running', 'waiting', 'ready']);

interface Props {
  run: WorkflowRun;
}

/** Hard-Stop affordance on the run inspector. Visible while the run is active
 *  (pending / running / waiting) or when a completed run still has recipients
 *  parked in the waiting tail. Confirms before firing, then surfaces the
 *  synchronous receipt via a toast; provider cancels fan out asynchronously. */
export function StopRunButton({ run }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelRunMutation = useCancelRun();

  // Only completed runs need the recipient check; active runs always show
  // Stop. Passing null disables the query so we don't fetch a recipient page
  // we won't read on the active/terminal-without-tail paths.
  const completed = run.status === 'completed';
  const recipientsQuery = useRunRecipients(completed ? run.id : null, {
    runStatus: run.status,
  });
  const hasWaitingTail = (recipientsQuery.data ?? []).some((r) =>
    NON_TERMINAL_RECIPIENT_STATUSES.has(r.status),
  );

  const visible = isRunActive(run.status) || (completed && hasWaitingTail);
  if (!visible) return null;

  const handleConfirm = () => {
    cancelRunMutation.mutate(
      { runId: run.id, reason: 'operator' },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          notificationService.success(
            'Run stopped. Cancelling in-flight calls where supported.',
          );
        },
        onError: (err) => {
          const message = summarizeApiErrorBody(decodeApiError(err), 'please try again');
          notificationService.error(`Could not stop run: ${message}`);
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="danger-outline"
        size="sm"
        icon={CircleStop}
        onClick={() => setConfirmOpen(true)}
      >
        Stop run
      </Button>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="Stop this run?"
        description="In-flight calls will be cancelled where supported. Sent messages cannot be recalled."
        confirmLabel="Stop run"
        cancelLabel="Keep running"
        variant="danger"
        isLoading={cancelRunMutation.isPending}
        icon={CircleStop}
      />
    </>
  );
}
