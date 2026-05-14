import { useParams } from 'react-router-dom';
import { AlertTriangle, XCircle } from 'lucide-react';
import { useCurrentAppId } from '@/hooks';
import { usePageMetadata } from '@/config/pageMetadata';
import { usePermission } from '@/utils/permissions';
import { runsForApp } from '@/config/routes';
import { LoadingState, PageSurface } from '@/components/ui';
import { InlineReviewProvider } from '@/features/reviews/inline';
import { RUN_DETAIL_REGISTRY } from './runDetail/registry';

/**
 * The single run-detail page for every app. Routed at `/runs/:runId`,
 * `/kaira/runs/:runId`, `/inside-sales/runs/:runId(/calls/:callId)`, etc.
 *
 * It owns the shared shell — PageSurface, InlineReviewProvider and the bounded
 * `flex flex-1 min-h-0 flex-col` body container — and nothing else. Every
 * per-app concern (data fetching, header, body, sub-routes) comes from the
 * app's entry in `RUN_DETAIL_REGISTRY`. There is no `app_id` branching here, so
 * the layout cannot drift per app the way the old forked pages did.
 */
export function RunDetailPage() {
  const { runId, callId } = useParams<{ runId: string; callId?: string }>();
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('runDetail');
  const canReview = usePermission('review:manage');
  const entry = RUN_DETAIL_REGISTRY[appId];

  // Hook is always called — `entry` is stable for the route's lifetime.
  const view = entry.useRunDetail(runId ?? '', callId);
  const back = { to: runsForApp(appId), label: 'Runs' };

  if (view.phase === 'loading') {
    return (
      <PageSurface icon={icon} title="Run" back={back} showHeader={false}>
        <LoadingState />
      </PageSurface>
    );
  }

  if (view.phase === 'notFound') {
    return (
      <PageSurface icon={icon} title="Run" back={back}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <XCircle className="h-10 w-10 text-[var(--text-muted)]" />
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Run not found</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            This evaluation run may have been deleted or doesn't exist.
          </p>
        </div>
      </PageSurface>
    );
  }

  if (view.phase === 'error') {
    return (
      <PageSurface icon={icon} title="Run" back={back}>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2 rounded border border-[var(--border-error)] bg-[var(--surface-error)] p-3 text-sm text-[var(--color-error)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {view.message}
          </div>
        </div>
      </PageSurface>
    );
  }

  return (
    <InlineReviewProvider runId={view.reviewRunId} appId={appId} enabled={canReview}>
      <PageSurface
        icon={view.header.icon}
        title={view.header.title}
        subtitle={view.header.subtitle}
        back={view.back ?? back}
        actions={view.header.actions}
      >
        <div className="flex flex-1 min-h-0 flex-col gap-4">{view.body}</div>
        {view.dialogs}
      </PageSurface>
    </InlineReviewProvider>
  );
}

export default RunDetailPage;
