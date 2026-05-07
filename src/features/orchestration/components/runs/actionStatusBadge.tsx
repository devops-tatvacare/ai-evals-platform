import { Badge } from '@/components/ui';
import { ACTION_STATUS_LABEL, ACTION_STATUS_VARIANT } from './actionStatusBadge.constants';

/** Action status pill — single source of truth for orchestration action
 *  status → badge variant. Mirrors `runStatusBadge.tsx` so the platform
 *  Logs page's Workflow actions tab and the per-run RunActionsPanel can
 *  share one mapping. New action statuses must add an entry to the
 *  constants module, not inline a colour at the call site. */
export function ActionStatusBadge({ status }: { status: string }) {
  const label = ACTION_STATUS_LABEL[status] ?? status;
  return (
    <Badge variant={ACTION_STATUS_VARIANT[status] ?? 'neutral'} size="sm">
      {label}
    </Badge>
  );
}
