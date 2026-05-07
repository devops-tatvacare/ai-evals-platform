import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageSurface } from '@/components/ui/PageSurface';
import { usePageMetadata } from '@/config/pageMetadata';
import { ApiError } from '@/services/api/client';
import { getWorkflow, listVersions } from '@/services/api/orchestration';
import type { WorkflowRun } from '@/features/orchestration/types';
import { notificationService } from '@/services/notifications';
import { useRunStream } from '@/features/orchestration/hooks/useRunStream';
import { useRunStatusToasts } from '@/features/orchestration/hooks/useRunStatusToasts';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import { Canvas } from './Canvas';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NodeParseIssuesBanner } from './NodeParseIssuesBanner';
import { Palette, usePaletteCatalogLoader } from './Palette';
import { WorkflowHeaderBar } from './WorkflowHeaderBar';
import { RunInspectorOverlay } from './runs/RunInspectorOverlay';

export function WorkflowBuilderPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { icon, title } = usePageMetadata('campaigns');
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);

  // Phase-14 follow-up — run inspector overlay state lives in the URL so
  // deep links from the campaign listing (and shared bookmarks) work. The
  // overlay opens on `?run=<id>`; the action-detail secondary opens on
  // `?action=<id>`; the active tab is `?tab=` (default 'recipients').
  const [searchParams, setSearchParams] = useSearchParams();
  // Treat `?run=` (empty / sentinel) as "open the inspector with no run
  // pre-selected so the picker can drive selection". This lets the
  // header [Runs] button request "open me with the picker" without
  // having to pre-select anything.
  const rawRunParam = searchParams.get('run');
  const inspectorRunId =
    rawRunParam && rawRunParam !== '__open__' ? rawRunParam : null;
  const inspectorActionId = searchParams.get('action');
  const inspectorTab = searchParams.get('tab') || 'recipients';

  const updateSearchParams = useCallback(
    (next: { run?: string | null; action?: string | null; tab?: string | null }) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(next)) {
            if (value === null || value === undefined || value === '') {
              params.delete(key);
            } else {
              params.set(key, value);
            }
          }
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );
  const closeInspector = useCallback(
    () => updateSearchParams({ run: null, action: null, tab: null }),
    [updateSearchParams],
  );
  const reset = useWorkflowBuilderStore((s) => s.reset);
  const setMetadata = useWorkflowBuilderStore((s) => s.setMetadata);
  const hydrate = useWorkflowBuilderStore((s) => s.hydrate);
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const clearSelection = useWorkflowBuilderStore((s) => s.clearSelection);
  const pendingDeleteNodeId = useWorkflowBuilderStore((s) => s.pendingDeleteNodeId);
  const cancelDeleteNode = useWorkflowBuilderStore((s) => s.cancelDeleteNode);
  const removeNode = useWorkflowBuilderStore((s) => s.removeNode);
  // Phase-14 follow-up — palette renders only in edit mode. View mode
  // shows the canvas + inspector (read-only) with no add-node affordance,
  // matching the "land safe, edit explicitly" UX call.
  const viewMode = useWorkflowBuilderStore((s) => s.viewMode);
  // The node-type catalog must load in both modes — the canvas reads it
  // to colour nodes by `displayCategory` and to discover each node's
  // declared output handles. Mounting the loader here (rather than
  // inside <Palette>) keeps the canvas correct in view mode where the
  // palette is hidden.
  usePaletteCatalogLoader();
  const pendingDeleteNode = useWorkflowBuilderStore((s) =>
    s.nodes.find((n) => n.id === s.pendingDeleteNodeId) ?? null,
  );

  useEffect(() => {
    if (!workflowId) return;
    let alive = true;
    (async () => {
      reset();
      try {
        const wf = await getWorkflow(workflowId);
        const versions = await listVersions(workflowId);
        const draft = versions.find((v) => v.status === 'draft');
        const targetVersion = draft ?? versions[0] ?? null;
        if (!alive) return;
        setMetadata({
          workflowId: wf.id,
          versionId: targetVersion?.id ?? null,
          name: wf.name,
          workflowType: wf.workflowType,
          currentPublishedVersionId: wf.currentPublishedVersionId,
        });
        if (targetVersion) {
          hydrate(targetVersion.definition);
        }
      } catch (e) {
        if (!alive) return;
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Failed to load workflow';
        notificationService.error(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workflowId, reset, setMetadata, hydrate]);

  // ESC clears selection so the inspector unmounts. The pane click handler
  // covers the canvas-click case (see Canvas.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedNodeId !== null) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedNodeId, clearSelection]);

  if (!workflowId) return <LoadingState />;

  // Live run state renders directly on the builder canvas (node status
  // pills + edge traversal highlights via ``Canvas``'s ``activeRunId``
  // prop). The session hooks below own the SSE stream and toast surface
  // — no panel, no split, no second canvas. Phase-13 UX rule.
  const liveRunId =
    activeRun && activeRun.workflowId === workflowId ? activeRun.id : undefined;
  // Phase-14 follow-up — when the inspector overlay is open with a past
  // run via `?run=<id>`, the canvas must paint THAT run's per-node
  // statuses, not the live one. The inspector hydrates `runOverlayStore`
  // for the URL-selected run; the canvas keys its display on
  // `activeRunId === overlayRunId`, so we forward whichever is current.
  // Live run wins when both are set (manual fire is the most-recent
  // intent).
  const canvasActiveRunId = liveRunId ?? inspectorRunId ?? undefined;
  // SSE only streams a live run; no point opening it for a past run.
  const sessionRunId = liveRunId;

  return (
    <>
    <PageSurface icon={icon} title={title} showHeader={false} bleed>
      <WorkflowHeaderBar
        onRunStarted={setActiveRun}
        onOpenRuns={(runId: string | null) => {
          // `null` opens the inspector with no run pre-selected so the
          // picker drives selection; a string deep-links to that run.
          // We pass a sentinel string when null because URLSearchParams
          // requires a value — the overlay treats empty/null the same
          // way (renders the "pick a run" empty state).
          updateSearchParams({ run: runId ?? '__open__', action: null });
        }}
      />
      <RunSession runId={sessionRunId} />
      <NodeParseIssuesBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {viewMode === 'edit' ? <Palette /> : null}
          <div className="min-w-0 flex-1">
            <Canvas activeRunId={canvasActiveRunId} />
          </div>
          <AnimatePresence initial={false}>
            {selectedNodeId !== null ? (
              // Phase 14 / C5 — key the inspector by selectedNodeId so any
              // per-form local state (e.g. SecretField revealed flag, any
              // future controlled inputs) resets cleanly when the operator
              // switches node selection. Without this key, the inspector
              // remained mounted across selections and form-local state
              // bled between nodes — one of the contributing mechanisms
              // for symptom S1 ("config lost on drag/select").
              <motion.div
                key={`inspector:${selectedNodeId}`}
                initial={{ x: 16, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 16, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="h-full flex-shrink-0"
              >
                <NodeConfigPanel />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </PageSurface>
    <ConfirmDialog
      isOpen={pendingDeleteNodeId !== null}
      onClose={cancelDeleteNode}
      onConfirm={() => {
        if (pendingDeleteNodeId) removeNode(pendingDeleteNodeId);
        cancelDeleteNode();
      }}
      title="Remove node from canvas?"
      description={
        pendingDeleteNode
          ? `Remove "${(pendingDeleteNode.data?.label as string) ?? pendingDeleteNode.type}" and any edges connected to it. This affects the draft only — the change is undone if you reload without saving.`
          : ''
      }
      confirmLabel="Remove"
      variant="danger"
    />
    {/* Phase-14 follow-up — the run inspector is the single surface for
     *  past + live runs across the app. Replaces the standalone
     *  RunDetailPage / CampaignRunsPage / WorkflowRunHistoryOverlay
     *  entry points. URL-driven so the campaign listing's drill-in icon
     *  can deep-link with `?run=<id>` and the same overlay opens. */}
    {searchParams.has('run') && workflowId ? (
      <RunInspectorOverlay
        workflowId={workflowId}
        runId={inspectorRunId}
        actionId={inspectorActionId}
        tabId={inspectorTab}
        onChangeRunId={(next) => updateSearchParams({ run: next, action: null })}
        onChangeTab={(next) => updateSearchParams({ tab: next })}
        onChangeActionId={(next) => updateSearchParams({ action: next })}
        onClose={closeInspector}
      />
    ) : null}
    </>
  );
}

/** Invisible host for the per-run side-effects: SSE stream that drives
 *  ``runOverlayStore`` (which the builder ``Canvas`` reads for node
 *  pills + edge highlights) and the toast surface for run.started /
 *  run.completed / run.failed. Mounted once when a run is in flight on
 *  the current workflow; unmounts (and tears the stream down) when the
 *  run is dismissed or the user switches workflow. */
function RunSession({ runId }: { runId: string | undefined }) {
  useRunStream(runId);
  useRunStatusToasts(runId);
  return null;
}
