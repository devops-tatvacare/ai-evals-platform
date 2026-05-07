import { useEffect, type CSSProperties, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Radio } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { LoadingState } from '@/components/ui';
import { PageSurface } from '@/components/ui/PageSurface';
import { Tabs } from '@/components/ui/Tabs';
import { usePageMetadata } from '@/config/pageMetadata';
import {
  fetchNodeTypes,
  getRun,
  getWorkflow,
  listVersions,
} from '@/services/api/orchestration';
import type {
  NodeTypeDescriptor,
  RunStatus,
  Workflow,
  WorkflowRun,
  WorkflowVersion,
} from '@/features/orchestration/types';
import { isRunActive } from '@/features/orchestration/types';
import { useRunStream } from '@/features/orchestration/hooks/useRunStream';
import { useRunStatusToasts } from '@/features/orchestration/hooks/useRunStatusToasts';
import { useOrchestrationRoutes } from '@/features/orchestration/hooks/useOrchestrationRoutes';
import {
  useRunOverlayStore,
  type RunStreamStatus,
} from '@/features/orchestration/store/runOverlayStore';
import { logger } from '@/services/logger';
import { ActionLogTab } from './ActionLogTab';
import { RecipientsTab } from './RecipientsTab';
import { RunCanvasOverlay } from './RunCanvasOverlay';

interface LoadedState {
  run: WorkflowRun;
  workflow: Workflow;
  version: WorkflowVersion;
  nodeTypes: NodeTypeDescriptor[];
}

/** Run detail page with three tabs: Canvas (live), Recipients, Action Log.
 *  Subscribes to the SSE stream for the lifetime of the page. */
export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { icon, title } = usePageMetadata('campaigns');
  const orchestrationRoutes = useOrchestrationRoutes();
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [error, setError] = useState<{ runId: string; message: string } | null>(null);

  useRunStream(runId);
  useRunStatusToasts(runId);

  const overlayRunId = useRunOverlayStore((s) => s.runId);
  const hydrated = useRunOverlayStore((s) => s.hydrated);
  const streamStatus = useRunOverlayStore((s) => s.streamStatus);
  const runStatus = useRunOverlayStore((s) => s.runStatus);
  const overlayByNodeId = useRunOverlayStore((s) => s.byNodeId);

  useEffect(() => {
    if (!runId) return;
    let alive = true;

    void (async () => {
      try {
        const run = await getRun(runId);
        const [workflow, versions, nodeTypes] = await Promise.all([
          getWorkflow(run.workflowId),
          listVersions(run.workflowId),
          fetchNodeTypes(),
        ]);
        if (!alive) return;
        const version = versions.find((v) => v.id === run.workflowVersionId) ?? null;
        if (!version) {
          setError({ runId, message: 'Workflow version not found for this run' });
          return;
        }
        setError(null);
        setLoaded({ run, workflow, version, nodeTypes });
      } catch (err) {
        if (!alive) return;
        logger.warn('RunDetailPage: load failed', { err: String(err) });
        setError({
          runId,
          message: err instanceof Error ? err.message : 'Failed to load run',
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [runId]);

  if (runId && error?.runId === runId) {
    return (
      <PageSurface icon={icon} title={title} showHeader={false} bleed>
        <div className="p-6 text-sm text-[var(--color-error)]">{error.message}</div>
      </PageSurface>
    );
  }
  if (!runId || !loaded || loaded.run.id !== runId) return <LoadingState />;

  const { run, workflow, version, nodeTypes } = loaded;
  const displayRunStatus = overlayRunId === run.id && hydrated ? runStatus : run.status;
  const liveLabel = getStreamLabel(streamStatus, displayRunStatus);
  const liveTone = getStreamTone(streamStatus, displayRunStatus);
  const states = Object.values(overlayByNodeId);
  const progress = {
    total: version.definition.nodes.length,
    completed: states.filter(
      (state) => state.status === 'completed' || state.status === 'skipped',
    ).length,
    running: states.filter((state) => state.status === 'running').length,
    failed: states.filter((state) => state.status === 'failed').length,
  };

  return (
    <PageSurface icon={icon} title={title} showHeader={false} bleed>
      <div
        className="border-b px-5 py-3"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              to={orchestrationRoutes.campaignBuilder(workflow.id)}
              className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{workflow.name}</span>
            </Link>
            <div className="text-lg font-semibold text-[var(--text-primary)]">
              Run {run.id.slice(0, 8)}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {run.triggeredBy} · cohort {run.cohortSizeAtEntry}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={getRunBadgeVariant(displayRunStatus)}>
                {displayRunStatus}
              </Badge>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={liveTone}
              >
                {streamStatus === 'open' ? (
                  <Radio className="h-3.5 w-3.5" />
                ) : streamStatus === 'connecting' || streamStatus === 'reconnecting' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Radio className="h-3.5 w-3.5" />
                )}
                <span>{liveLabel}</span>
              </span>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {progress.completed}/{progress.total} nodes finished
                {progress.running > 0 ? ` · ${progress.running} running` : ''}
                {progress.failed > 0 ? ` · ${progress.failed} failed` : ''}
              </span>
            </div>
          </div>
          <div className="max-w-[360px] text-right text-xs text-[var(--text-secondary)]">
            {streamStatus === 'reconnecting' || streamStatus === 'error' ? (
              <span>
                Live updates are catching up. The canvas is pinned to the latest confirmed
                run snapshot until the stream reconnects.
              </span>
            ) : isRunActive(displayRunStatus) ? (
              <span>
                Keep this page open to follow live node progress across the canvas,
                recipients, and action log.
              </span>
            ) : (
              <span>
                This run is no longer active. The viewer is showing the final recorded
                state.
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Tabs
          fillHeight
          tabs={[
            {
              id: 'canvas',
              label: 'Canvas (Live)',
              content: (
                <RunCanvasOverlay
                  version={version}
                  nodeTypesRegistry={nodeTypes}
                />
              ),
            },
            {
              id: 'recipients',
              label: 'Recipients',
              content: <RecipientsTab runId={run.id} runStatus={displayRunStatus} />,
            },
            {
              id: 'log',
              label: 'Action Log',
              content: <ActionLogTab runId={run.id} runStatus={displayRunStatus} />,
            },
          ]}
        />
      </div>
    </PageSurface>
  );
}

function getRunBadgeVariant(status: RunStatus): 'neutral' | 'info' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'running':
      return 'info';
    case 'waiting':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'neutral';
  }
}

function getStreamLabel(
  streamStatus: RunStreamStatus,
  runStatus: RunStatus,
): string {
  if (!isRunActive(runStatus)) {
    return 'Final state';
  }
  switch (streamStatus) {
    case 'open':
      return 'Live';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'error':
      return 'Retrying…';
    case 'closed':
      return 'Paused';
    default:
      return 'Preparing…';
  }
}

function getStreamTone(
  streamStatus: RunStreamStatus,
  runStatus: RunStatus,
): CSSProperties {
  if (!isRunActive(runStatus)) {
    return {
      backgroundColor: 'var(--bg-tertiary)',
      color: 'var(--text-secondary)',
    };
  }
  if (streamStatus === 'open') {
    return {
      backgroundColor: 'var(--surface-success)',
      color: 'var(--color-success)',
    };
  }
  if (streamStatus === 'error' || streamStatus === 'reconnecting') {
    return {
      backgroundColor: 'var(--surface-warning)',
      color: 'var(--color-warning)',
    };
  }
  return {
    backgroundColor: 'var(--surface-info)',
    color: 'var(--color-info)',
  };
}
