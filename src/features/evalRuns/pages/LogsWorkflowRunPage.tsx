import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useCurrentAppId } from '@/hooks';
import { apiLogsForApp } from '@/config/routes';
import { EmptyState, LoadingState, PageSurface, Tabs } from '@/components/ui';
import { usePageMetadata } from '@/config/pageMetadata';
import { useRun, useWorkflows } from '@/features/orchestration/queries/runs';
import { RunStatusBadge } from '@/features/orchestration/components/runs/runStatusBadge';
import { RunRecipientsPanel } from '@/features/orchestration/components/runs/RunRecipientsPanel';
import { RunActionsPanel } from '@/features/orchestration/components/runs/RunActionsPanel';

const TAB_RECIPIENTS = 'recipients';
const TAB_ACTIONS = 'actions';

function formatAbsolute(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function durationSummary(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Phase 15.1c — sub-route page under `/<app>/logs/workflow-runs/:runId`.
 * Replaces the inline-overlay drill from the Workflow runs tab so the
 * drill has a real URL, real page chrome, real back button.
 *
 * Body composition mirrors `RunInspectorOverlay` (same Recipients +
 * Action log tabs, same `RunRecipientsPanel` and `RunActionsPanel`
 * components) — the only difference is the chrome (PageSurface vs
 * RightSlideOverShell). Single source of truth for the panels; we just
 * mount them on a different surface.
 *
 * Action row click in the "Action log" tab navigates to
 * `/<app>/logs/workflow-actions/:actionId?run=<runId>` so the drill stack
 * stays on the Logs page rather than cross-cutting to the builder.
 */
export default function LogsWorkflowRunPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const appId = useCurrentAppId();
  const { icon } = usePageMetadata('logs');

  const runQuery = useRun(runId || null);
  const run = runQuery.data ?? null;
  const workflowsQuery = useWorkflows({ appId, enabled: Boolean(run) });
  const workflowName = useMemo(() => {
    if (!run) return null;
    return workflowsQuery.data?.find((w) => w.id === run.workflowId)?.name ?? null;
  }, [workflowsQuery.data, run]);

  const back = {
    to: `${apiLogsForApp(appId)}?type=workflow-runs`,
    label: 'Workflow runs',
  };

  if (runQuery.isLoading && !run) {
    return (
      <PageSurface icon={icon} title="Workflow run" back={back}>
        <LoadingState />
      </PageSurface>
    );
  }

  if (!run) {
    return (
      <PageSurface icon={icon} title="Workflow run" back={back}>
        <EmptyState
          icon={icon}
          title="Run not found"
          description="The run may have been removed, or you don't have access to its workflow."
          fill
        />
      </PageSurface>
    );
  }

  const title = workflowName ?? `Run ${run.id.slice(-8)}`;
  const subtitle = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
      <RunStatusBadge status={run.status} />
      <span>
        Started{' '}
        <strong className="font-mono font-medium text-[var(--text-primary)]">
          {formatAbsolute(run.startedAt)}
        </strong>
      </span>
      <span>
        Cohort{' '}
        <strong className="font-mono font-medium text-[var(--text-primary)]">
          {run.cohortSizeAtEntry}
        </strong>
      </span>
      <span>
        Duration{' '}
        <strong className="font-mono font-medium text-[var(--text-primary)]">
          {durationSummary(run.startedAt, run.completedAt)}
        </strong>
      </span>
      <span>
        Triggered by{' '}
        <strong className="font-mono font-medium text-[var(--text-primary)]">
          {run.triggeredBy}
        </strong>
      </span>
    </div>
  );

  return (
    <PageSurface icon={icon} title={title} subtitle={subtitle} back={back} bleed>
      <Tabs
        fillHeight
        defaultTab={TAB_RECIPIENTS}
        tabs={[
          {
            id: TAB_RECIPIENTS,
            label: 'Recipients',
            content: <RunRecipientsPanel runId={run.id} runStatus={run.status} />,
          },
          {
            id: TAB_ACTIONS,
            label: 'Action log',
            content: (
              <RunActionsPanel
                runId={run.id}
                runStatus={run.status}
                onSelectAction={(actionId) => {
                  if (!actionId) return;
                  navigate(
                    `${apiLogsForApp(appId)}/workflow-actions/${actionId}?run=${run.id}`,
                  );
                }}
              />
            ),
          },
        ]}
      />
    </PageSurface>
  );
}
