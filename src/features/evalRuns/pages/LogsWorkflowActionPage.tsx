import { useParams, useSearchParams } from 'react-router-dom';

import { useCurrentAppId } from '@/hooks';
import { apiLogsForApp } from '@/config/routes';
import { EmptyState, LoadingState, PageSurface } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { useRunAction } from '@/features/orchestration/queries/runs';
import { ActionDetailContent } from '@/features/orchestration/components/ActionDetailPanel';

/**
 * Phase 15.1b — sub-route page under `/logs/workflow-actions/:actionId`.
 * Replaces the row-click slide-over so the platform Logs page's drill-down
 * is a real route with PageSurface chrome and a back button.
 *
 * State: the action row's parent `runId` arrives in `?run=<id>` (the Logs
 * tab writes that on row click). The page resolves the action through the
 * run-scoped detail endpoint so deep links and large runs stay correct.
 */
export default function LogsWorkflowActionPage() {
  const { actionId = '' } = useParams<{ actionId: string }>();
  const [searchParams] = useSearchParams();
  const runId = searchParams.get('run') ?? '';
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('logs');

  const actionQuery = useRunAction(runId || null, actionId || null);
  const action = actionQuery.data ?? null;

  const back = {
    to: `${apiLogsForApp(appId)}?type=workflow-actions`,
    label: 'Workflow actions',
  };

  if (!runId) {
    return (
      <PageSurface icon={icon} title="Action detail" back={back}>
        <EmptyState
          icon={icon}
          title="Missing run context"
          description="Open this action from the Workflow actions tab so the run id can be resolved."
          fill
        />
      </PageSurface>
    );
  }

  if (actionQuery.isLoading && !action) {
    return (
      <PageSurface icon={icon} title="Action detail" back={back}>
        <LoadingState />
      </PageSurface>
    );
  }

  if (!action) {
    return (
      <PageSurface icon={icon} title="Action detail" back={back}>
        <EmptyState
          icon={icon}
          title="Action not found"
          description={
            (actionQuery.error as Error | null)?.message ??
            "The action may have been removed, or you don't have access to its run."
          }
          fill
        />
      </PageSurface>
    );
  }

  const title = `${action.channel.toUpperCase()} · ${action.actionType}`;
  const subtitle = `${action.recipientId}${action.providerCorrelationId ? ` · ${action.providerCorrelationId}` : ''}`;

  return (
    <PageSurface icon={icon} title={title} subtitle={subtitle} back={back} bleed>
      <ActionDetailContent action={action} />
    </PageSurface>
  );
}
