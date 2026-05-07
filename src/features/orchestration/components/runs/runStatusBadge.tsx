import { Badge, type BadgeVariant } from '@/components/ui';
import type { RunStatus } from '@/features/orchestration/types';

/** Single source of truth for run-status → badge variant mapping. Mirrors
 *  the pattern `ScheduleHistoryOverlay` uses for fire status — keeps the
 *  visual vocabulary platform-consistent (success / info / warning /
 *  danger / neutral). New run statuses must add an entry here, not
 *  inline a colour at the call site. */
export const RUN_STATUS_VARIANT: Record<RunStatus, BadgeVariant> = {
  pending: 'neutral',
  running: 'info',
  waiting: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant={RUN_STATUS_VARIANT[status]} size="sm">
      {RUN_STATUS_LABEL[status]}
    </Badge>
  );
}
