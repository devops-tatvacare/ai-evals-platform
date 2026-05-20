import { useEffect, useId, useMemo, useState } from 'react';
import { RefreshCw, Timeline, X } from 'lucide-react';

import {
  EmptyState,
  LoadingState,
  RightSlideOverShell,
  Tabs,
} from '@/components/ui';
import { cn } from '@/utils';
import { useRunOverlayStore } from '@/features/orchestration/store/runOverlayStore';
import {
  useRun,
  useRunOverlaySnapshot,
  useWorkflowRuns,
} from '@/features/orchestration/queries/runs';

import { ActionDetailOverlay } from './ActionDetailOverlay';
import { RunActionsPanel } from './RunActionsPanel';
import { RunPicker } from './RunPicker';
import { RunRecipientsPanel } from './RunRecipientsPanel';
import { RunStatusBadge } from './runStatusBadge';
import { StopRunButton } from './StopRunButton';
import { TerminationReceiptPanel } from './TerminationReceiptPanel';

interface Props {
  workflowId: string;
  /** Active run id from the URL query (`?run=<id>`). When null, the
   *  overlay opens with no run selected — the picker is the only UI
   *  surface; selecting a run flips this through `onChangeRunId`. */
  runId: string | null;
  /** Active action id. Pass through URL state (`?action=<id>`) on the
   *  builder; pass `undefined` on surfaces that don't track action
   *  selection in URL (listing) and the overlay manages it in local
   *  state. */
  actionId?: string | null;
  /** Active tab id. Same controlled-vs-uncontrolled story as
   *  `actionId`: pass through URL state on the builder, pass
   *  `undefined` on the listing for local state. */
  tabId?: string;
  onChangeRunId(next: string): void;
  onChangeTab?(next: string): void;
  onChangeActionId?(next: string | null): void;
  onClose(): void;
}

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

function durationSummary(
  startedAt: string | null,
  completedAt: string | null,
): string {
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
 * Primary right-edge overlay that replaces the standalone `RunDetailPage`
 * + `CampaignRunsPage` + `WorkflowRunHistoryOverlay`. Mirrors the
 * `ScheduleHistoryOverlay` chassis exactly (shell, header, refresh,
 * close, scrollable body) so the run-detail surface matches every other
 * right-edge inspector in the app.
 *
 * State model: URL is the source of truth. `runId`, `actionId`, `tabId`
 * arrive via props; the parent (WorkflowBuilderPage) reads/writes them
 * through `useSearchParams`. The overlay never owns selection state.
 *
 * Live updates: `useWorkflowRuns` polls while any run is active; `useRun`
 * polls while the active run is in-flight. The canvas behind picks up
 * live node statuses through `runOverlayStore`, which we sync below.
 */
export function RunInspectorOverlay({
  workflowId,
  runId,
  actionId: actionIdProp,
  tabId: tabIdProp,
  onChangeRunId,
  onChangeTab: onChangeTabProp,
  onChangeActionId: onChangeActionIdProp,
  onClose,
}: Props) {
  // Controlled-or-uncontrolled — when the parent passes the prop and a
  // setter, those win; otherwise local state owns the value. This keeps
  // the builder URL-driven (deep links) while the listing entry point
  // operates without polluting the URL.
  const [localActionId, setLocalActionId] = useState<string | null>(null);
  const [localTabId, setLocalTabId] = useState<string>('recipients');
  const actionId = actionIdProp ?? localActionId;
  const tabId = tabIdProp ?? localTabId;
  const onChangeActionId = onChangeActionIdProp ?? setLocalActionId;
  const onChangeTab = onChangeTabProp ?? setLocalTabId;
  const titleId = useId();
  const runsQuery = useWorkflowRuns(workflowId);
  const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data?.runs]);
  const runQuery = useRun(runId);
  const run = runQuery.data ?? null;

  // Sync the active run id into the canvas overlay store so the builder
  // canvas behind the overlay paints node statuses for the selected run.
  // Clearing on unmount keeps an open builder canvas free of stale run
  // overlay when the operator closes the inspector.
  const activateOverlayRun = useRunOverlayStore((s) => s.activateRun);
  const clearOverlayRun = useRunOverlayStore((s) => s.clearRun);
  const hydrateOverlay = useRunOverlayStore((s) => s.hydrateSnapshot);

  // Fetch the per-node overlay snapshot so the canvas behind the overlay
  // paints node statuses for the selected past run. For live runs, the
  // SSE stream (mounted by `RunSession` in WorkflowBuilderPage) keeps
  // overwriting this hydration with deltas — both paths target the same
  // `runOverlayStore` so they reconcile cleanly.
  const overlayQuery = useRunOverlaySnapshot(runId, {
    runStatus: run?.status ?? undefined,
  });

  useEffect(() => {
    if (!runId) return;
    activateOverlayRun(runId);
    return () => {
      // `clearRun(runId)` only clears if the store still owns this run.
      // Prevents a fast-switch race from clearing a freshly-activated run.
      clearOverlayRun(runId);
    };
  }, [runId, activateOverlayRun, clearOverlayRun]);

  useEffect(() => {
    if (!runId) return;
    const snapshot = overlayQuery.data;
    if (!snapshot) return;
    hydrateOverlay(runId, snapshot);
  }, [runId, overlayQuery.data, hydrateOverlay]);

  const refreshing = runsQuery.isFetching || runQuery.isFetching;
  const refresh = () => {
    runsQuery.refetch();
    if (runId) runQuery.refetch();
  };

  // Empty workflow case — never had a run. Surface the same EmptyState
  // pattern ScheduleHistoryOverlay uses so the empty path looks like
  // every other empty-state in the app.
  const showZeroRunsEmpty =
    !runsQuery.isLoading && runs.length === 0;

  return (
    <RightSlideOverShell
      isOpen={true}
      onClose={onClose}
      labelledBy={titleId}
      widthClassName="w-[var(--overlay-width-lg)] max-w-[92vw]"
    >
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Timeline className="mt-0.5 h-4 w-4 text-[var(--text-muted)]" />
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="truncate text-sm font-semibold text-[var(--text-primary)]"
                >
                  Run inspector
                </h2>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  {runs.length === 0
                    ? 'No runs yet for this workflow'
                    : `${runs.length} run${runs.length === 1 ? '' : 's'} on this workflow`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={refresh}
                disabled={refreshing}
                className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                title="Refresh"
                aria-label="Refresh runs"
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              </button>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
                title="Close"
                aria-label="Close run inspector"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!showZeroRunsEmpty ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                Active run
              </span>
              <RunPicker
                runs={runs}
                selectedRunId={runId}
                onChange={onChangeRunId}
                disabled={runsQuery.isLoading}
                className="min-w-[260px] flex-1"
              />
              {run ? <RunStatusBadge status={run.status} /> : null}
              {run ? <StopRunButton run={run} /> : null}
            </div>
          ) : null}

          {run ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)]">
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
          ) : null}

          {run ? (
            <div className="mt-2">
              <TerminationReceiptPanel key={run.id} run={run} />
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {showZeroRunsEmpty ? (
            <EmptyState
              icon={Timeline}
              title="No runs yet"
              description="This workflow has not been run. Click Run Now from the header to create the first run."
              fill
            />
          ) : runQuery.isLoading && !run ? (
            <LoadingState />
          ) : !runId ? (
            <EmptyState
              icon={Timeline}
              title="Pick a run to inspect"
              description="Choose a run from the picker above to see its recipients and action log."
              fill
            />
          ) : (
            <Tabs
              fillHeight
              defaultTab={tabId}
              onChange={onChangeTab}
              tabs={[
                {
                  id: TAB_RECIPIENTS,
                  label: 'Recipients',
                  content: (
                    <RunRecipientsPanel
                      runId={runId}
                      runStatus={run?.status ?? null}
                    />
                  ),
                },
                {
                  id: TAB_ACTIONS,
                  label: 'Action log',
                  content: (
                    <RunActionsPanel
                      runId={runId}
                      runStatus={run?.status ?? null}
                      onSelectAction={onChangeActionId}
                    />
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Secondary right-overlay stacked above this one; pure URL-driven
       *  open/close so a deep link `?run=...&action=...` lights up both
       *  surfaces in the same render. */}
      {runId && actionId ? (
        <ActionDetailOverlay
          runId={runId}
          actionId={actionId}
          onClose={() => onChangeActionId(null)}
        />
      ) : null}
    </RightSlideOverShell>
  );
}
