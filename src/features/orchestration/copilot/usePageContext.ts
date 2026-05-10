/**
 * Phase 2 (sherlock-builder) — page-context selector for the chat widget.
 *
 * Self-contained per the design doc: NO new context provider, NO prop
 * drilling, NO new global store. Reads the existing `workflowBuilderStore`
 * and the current router location.
 *
 * Two consumers, two entry points:
 *   - `usePageContext()` — React hook (re-renders on relevant changes).
 *     Used by `ChatInput` to render the chip and by tests.
 *   - `getPageContextSnapshot()` — non-hook one-shot getter. Used by the
 *     Zustand `send` action which can't call hooks. Reads via
 *     `useWorkflowBuilderStore.getState()` + `window.location.pathname`.
 *
 * Per-message dismiss is a module-scoped one-shot flag (`dismissNextPageContext`
 * sets it; `getPageContextSnapshot` consumes it once and returns 'none' for
 * that single read). The chip's [×] flips a local component state for the
 * visual hide, then calls `dismissNextPageContext` on submit.
 */
import { useMemo } from 'react';
import { useLocation, matchPath } from 'react-router-dom';

import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

type WorkflowBuilderStoreState = ReturnType<typeof useWorkflowBuilderStore.getState>;
import type { WorkflowDefinition } from '@/features/orchestration/types';

export type ViewMode = 'view' | 'edit';

export type PageContext =
  | {
      kind: 'orchestration_builder';
      workflowId: string;
      versionId: string | null;
      workflowType: 'crm' | 'clinical';
      appId: string;
      selectedNodeId: string | null;
      definition: WorkflowDefinition;
      dataHash: string;
      viewMode: ViewMode;
      workflowName: string;
    }
  | { kind: 'none' };

const BUILDER_ROUTE_PATTERNS: ReadonlyArray<{ pattern: string; appId: string }> = [
  { pattern: '/inside-sales/orchestration/workflows/:workflowId', appId: 'inside-sales' },
  { pattern: '/kaira/orchestration/workflows/:workflowId', appId: 'kaira-bot' },
  { pattern: '/orchestration/workflows/:workflowId', appId: 'voice-rx' },
];

/** Match the current pathname against the known builder routes. Returns the
 *  resolved app id (so the chat widget threads the same app the canvas
 *  belongs to) or null when off the builder. */
function matchBuilderRoute(pathname: string): { appId: string } | null {
  for (const { pattern, appId } of BUILDER_ROUTE_PATTERNS) {
    if (matchPath({ path: pattern, end: false }, pathname)) {
      return { appId };
    }
  }
  return null;
}

let dismissPending = false;

/** One-shot dismiss flag consumed by the next `getPageContextSnapshot` call.
 *  ChatInput calls this when the user clicks [×] on the chip; the chip's
 *  local visible-state is reset on the next submit so the chip reappears
 *  for the following turn (per the design — chip is derived, not stored). */
export function dismissNextPageContext(): void {
  dismissPending = true;
}

function buildContext(
  pathname: string,
  state: WorkflowBuilderStoreState,
): PageContext {
  const route = matchBuilderRoute(pathname);
  if (!route) return { kind: 'none' };
  if (!state.workflowId || !state.workflowType) return { kind: 'none' };

  const definition: WorkflowDefinition = {
    nodes: state.nodes,
    edges: state.edges,
  };
  if (state.viewport) {
    definition.canvas = { viewport: state.viewport };
  }

  return {
    kind: 'orchestration_builder',
    workflowId: state.workflowId,
    versionId: state.versionId,
    workflowType: state.workflowType,
    appId: route.appId,
    selectedNodeId: state.selectedNodeId,
    definition,
    dataHash: state.currentDataHash,
    viewMode: state.viewMode,
    workflowName: state.workflowName,
  };
}

/** Hook variant — re-renders when the pathname or relevant store fields
 *  change. Used inside ChatInput / chip / tests. */
export function usePageContext(): PageContext {
  const { pathname } = useLocation();
  const workflowId = useWorkflowBuilderStore((s) => s.workflowId);
  const versionId = useWorkflowBuilderStore((s) => s.versionId);
  const workflowType = useWorkflowBuilderStore((s) => s.workflowType);
  const workflowName = useWorkflowBuilderStore((s) => s.workflowName);
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  const dataHash = useWorkflowBuilderStore((s) => s.currentDataHash);
  const viewMode = useWorkflowBuilderStore((s) => s.viewMode);
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const viewport = useWorkflowBuilderStore((s) => s.viewport);

  return useMemo<PageContext>(() => {
    const route = matchBuilderRoute(pathname);
    if (!route) return { kind: 'none' };
    if (!workflowId || !workflowType) return { kind: 'none' };

    const definition: WorkflowDefinition = { nodes, edges };
    if (viewport) {
      definition.canvas = { viewport };
    }

    return {
      kind: 'orchestration_builder',
      workflowId,
      versionId,
      workflowType,
      appId: route.appId,
      selectedNodeId,
      definition,
      dataHash,
      viewMode,
      workflowName,
    };
  }, [
    pathname,
    workflowId,
    versionId,
    workflowType,
    workflowName,
    selectedNodeId,
    dataHash,
    viewMode,
    nodes,
    edges,
    viewport,
  ]);
}

/** Non-hook one-shot snapshot for store actions / event callbacks.
 *  Honours the dismiss flag exactly once: if the chip's [×] was clicked
 *  before send, the next call returns `{ kind: 'none' }` and clears the
 *  flag, regardless of whether the user is actually on the builder. */
export function getPageContextSnapshot(): PageContext {
  if (dismissPending) {
    dismissPending = false;
    return { kind: 'none' };
  }
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const state = useWorkflowBuilderStore.getState();
  return buildContext(pathname, state);
}

/** Test-only: clear the dismiss flag between cases. */
export function __resetDismissForTests(): void {
  dismissPending = false;
}
