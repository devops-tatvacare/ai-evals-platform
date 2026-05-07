import { Navigate, useParams } from 'react-router-dom';

import { LoadingState } from '@/components/ui';
import { useRun } from '@/features/orchestration/queries/runs';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';

/**
 * Phase-14 follow-up — legacy `/orchestration/runs/:runId` route survives
 * for bookmarks / emails / external links, but every entry point now
 * routes through the unified run inspector overlay on the builder
 * canvas. This component fetches the run by id, then `Navigate`s to the
 * builder with `?run=<id>` so the operator lands on the right surface
 * regardless of where the link came from.
 *
 * On error / not-found we fall back to the campaigns list — same
 * behaviour as the old `RunDetailPage` did when a run id 404'd.
 */
export function LegacyRunDetailRedirect() {
  const { runId } = useParams<{ runId: string }>();
  const orchestrationRoutes = useOrchestrationRoutes();
  const { data: run, isLoading, isError } = useRun(runId);

  if (!runId) return <Navigate to={orchestrationRoutes.campaigns} replace />;
  if (isLoading) return <LoadingState />;
  if (isError || !run) {
    return <Navigate to={orchestrationRoutes.campaigns} replace />;
  }
  return (
    <Navigate
      to={`${orchestrationRoutes.campaignBuilder(run.workflowId)}?run=${run.id}`}
      replace
    />
  );
}
