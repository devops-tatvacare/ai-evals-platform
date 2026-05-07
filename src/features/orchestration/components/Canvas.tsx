import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useMemo, useRef, type DragEvent } from 'react';
import '@xyflow/react/dist/style.css';

import { getCategoryAccentToken } from '@/features/orchestration/config/categories';
import { useRunOverlayStore, type NodeStepState } from '@/features/orchestration/store/runOverlayStore';
import {
  usePublishErrorsByNodeId,
  useWorkflowBuilderStore,
} from '@/features/orchestration/store/workflowBuilderStore';
import type { FieldErrorItem } from '@/features/orchestration/contracts/errorDecoder';
import {
  getEdgeOutputId,
  type NodeTypeDescriptor,
  type WorkflowDefinitionNode,
} from '@/features/orchestration/types';
import { resolveColor } from '@/utils/statusColors';
import { CustomNode, type NodeOverlay } from './CustomNode';

const nodeTypes = { custom: CustomNode };

// Stable empty fallback for the run overlay slice so ``activeOverlay``
// keeps the same reference between renders when no run is in flight.
// Avoids re-running the rfNodes / rfEdges memos on every keystroke.
const EMPTY_OVERLAY: Record<string, NodeStepState> = Object.freeze({});

/** Derive the runtime output-handle labels for a node.
 *
 * Most nodes carry static handles from their palette descriptor
 * (`outputEdges`). `logic.split` is special: branch labels live in
 * `config.branches[*].label`, so the canvas must recompute them per node
 * config — the static descriptor for split is empty and would otherwise
 * collapse into a single `default` handle. */
function deriveOutputEdges(
  node: WorkflowDefinitionNode,
  desc: NodeTypeDescriptor | undefined,
): string[] {
  if (node.type === 'logic.split') {
    // Phase 11 §6.3: split branches carry stable ids; routing keys off
    // ``branch.id``, never the human-editable label.
    const branches = (node.config?.branches as Array<{ id?: string }> | undefined) ?? [];
    const ids = branches
      .map((b) => (typeof b?.id === 'string' ? b.id.trim() : ''))
      .filter((s) => s.length > 0);
    if (ids.length > 0) return ids;
  }
  if (node.type === 'logic.wait') {
    // Phase 11 §6.4: only the outputs that match the configured wait mode
    // are valid — the descriptor lists all three (wakeup / event /
    // timeout) for the validator's benefit, but the canvas should render
    // only the ones the operator can actually wire.
    const cfg = (node.config ?? {}) as { mode?: string };
    if (cfg.mode === 'duration' || cfg.mode === 'until_datetime') return ['wakeup'];
    if (cfg.mode === 'event') return ['event'];
    if (cfg.mode === 'event_or_timeout') return ['event', 'timeout'];
  }
  const fromDesc = (desc?.outputEdges ?? []).map((oe) => oe.id);
  return fromDesc.length > 0 ? fromDesc : ['default'];
}

/** Map a node's outgoing handle ids to human-readable labels for the
 *  canvas card (e.g. ``success`` -> ``Success``). Split nodes use the
 *  branch's editable label, mirroring the ``id -> label`` shape declared
 *  on the descriptor for static outputs. */
function deriveOutputEdgeLabels(
  node: WorkflowDefinitionNode,
  desc: NodeTypeDescriptor | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (node.type === 'logic.split') {
    const branches =
      (node.config?.branches as Array<{ id?: string; label?: string }> | undefined) ?? [];
    for (const b of branches) {
      if (typeof b?.id === 'string' && b.id.trim().length > 0) {
        out[b.id] = typeof b.label === 'string' && b.label.trim().length > 0 ? b.label : b.id;
      }
    }
    return out;
  }
  for (const oe of desc?.outputEdges ?? []) {
    out[oe.id] = oe.label ?? oe.id;
  }
  return out;
}

/** Derive the visible label for one canvas edge from the source node's
 *  descriptor (or split-branch config). Falls back to the raw output id
 *  when no human label is declared — the canvas always shows *something*
 *  rather than silently rendering label-less edges. */
function descriptorEdgeLabel(
  palette: NodeTypeDescriptor[],
  sourceNodeId: string,
  outputId: string,
  nodes: readonly WorkflowDefinitionNode[],
): string {
  const node = nodes.find((n) => n.id === sourceNodeId);
  if (!node) return outputId;
  const desc = palette.find((p) => p.nodeType === node.type);
  const labels = deriveOutputEdgeLabels(node, desc);
  return labels[outputId] ?? outputId;
}

/** Map a per-node run-step record onto the ``CustomNode``-friendly
 *  overlay shape. Keeps the run store decoupled from the canvas card —
 *  the card only knows ``status`` + ``cohortSize``. */
function deriveNodeOverlay(step: NodeStepState | undefined): NodeOverlay | undefined {
  if (!step) return undefined;
  return {
    status: step.status,
    cohortSize: step.inputCohortSize,
  };
}

/** Edge styling for live runs. An edge is "traversed" once the source
 *  node has completed AND the target node has started (any non-pending
 *  state). Failed targets paint the edge red so the failure point is
 *  obvious at a glance; everything else uses the success token. */
function deriveEdgeTraversal(
  sourceId: string,
  targetId: string,
  byNodeId: Record<string, NodeStepState>,
): { style: React.CSSProperties; animated: boolean } | null {
  const src = byNodeId[sourceId];
  if (!src || src.status !== 'completed') return null;
  const tgt = byNodeId[targetId];
  if (!tgt) return null;
  if (
    tgt.status !== 'running' &&
    tgt.status !== 'completed' &&
    tgt.status !== 'failed' &&
    tgt.status !== 'skipped'
  ) {
    return null;
  }
  const colorVar = tgt.status === 'failed' ? 'var(--color-error)' : 'var(--color-success)';
  return {
    // ``stroke`` on an SVG path resolves CSS variables in modern browsers
    // (Chromium/WebKit/Firefox), but ReactFlow paints arrowheads via
    // ``markerEnd`` whose color is read from ``stroke``. Resolving here
    // keeps both ends in sync regardless of the renderer's quirks.
    style: { stroke: resolveColor(colorVar), strokeWidth: 2.5 },
    animated: tgt.status === 'running',
  };
}

export interface CanvasProps {
  /** When set, the main builder canvas merges live run state from
   *  ``runOverlayStore`` into each node (status pill + cohort) and
   *  highlights traversed edges. Per Phase-13 UX: run progress renders
   *  on the *same* canvas — no split panel, no second canvas.
   *  ``undefined`` keeps the canvas in pure-builder mode. */
  activeRunId?: string;
}

export function Canvas({ activeRunId }: CanvasProps = {}) {
  return (
    <ReactFlowProvider>
      <CanvasInner activeRunId={activeRunId} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ activeRunId }: { activeRunId?: string }) {
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const selectedNodeId = useWorkflowBuilderStore((s) => s.selectedNodeId);
  // Phase-14 follow-up — view mode disables every write affordance on
  // the canvas (drop, connect, edge-remove, per-node delete). Click-to-
  // select still works so the inspector can render the node read-only.
  const viewMode = useWorkflowBuilderStore((s) => s.viewMode);
  const isEdit = viewMode === 'edit';
  // Phase 14 / Phase E — last publish failure, grouped by node id. The
  // CustomNode renders a red badge when its id has at least one entry.
  const publishErrorsByNode: Record<string, FieldErrorItem[]> =
    usePublishErrorsByNodeId();

  const overlayRunId = useRunOverlayStore((s) => s.runId);
  const overlayByNodeId = useRunOverlayStore((s) => s.byNodeId);
  // Only consume overlay state when the active run still owns the store.
  // Stale runs from a previous workflow tab are ignored. Memoised so the
  // node/edge useMemo dependency arrays remain stable across renders.
  const activeOverlay: Record<string, NodeStepState> = useMemo(
    () => (activeRunId && overlayRunId === activeRunId ? overlayByNodeId : EMPTY_OVERLAY),
    [activeRunId, overlayRunId, overlayByNodeId],
  );

  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const desc = palette.find((p) => p.nodeType === n.type);
        return {
          id: n.id,
          type: 'custom',
          position: n.position,
          // Zustand owns selection; mirror it onto React Flow's per-node
          // ``selected`` flag so RF and the inspector cannot drift. Without
          // this, RF caches its own selection state and skips firing
          // ``onNodeClick`` when the same node is clicked twice in a row
          // after the inspector closes.
          selected: n.id === selectedNodeId,
          // Explicit width/height so the MiniMap has bounding boxes to
          // render before ResizeObserver measurement lands. Matches the
          // NodeCard's `min-w-[220px]` and a typical 2-line content
          // height; the React Flow layout still uses measured values
          // for canvas positioning.
          width: 240,
          height: 80,
          data: {
            label: desc?.displayLabel ?? desc?.label ?? n.type,
            nodeType: n.type,
            category: desc?.category ?? 'logic',
            displayCategory: desc?.displayCategory ?? 'routing',
            description: desc?.description,
            outputEdges: deriveOutputEdges(n, desc),
            outputEdgeLabels: deriveOutputEdgeLabels(n, desc),
            overlay: deriveNodeOverlay(activeOverlay[n.id]),
            // Phase 14 / Phase E — surface the publish-failure entries
            // for this node so the CustomNode renders the red badge.
            // Empty for nodes without errors; CustomNode treats `[]` and
            // `undefined` the same.
            publishErrors: publishErrorsByNode[n.id],
            // Phase-14 follow-up — when false, the per-node delete affordance
            // hides and the card stays read-only. Click-to-select still
            // works so the inspector can show the config.
            editable: isEdit,
          },
        };
      }),
    [nodes, palette, selectedNodeId, activeOverlay, publishErrorsByNode, isEdit],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const outputId = getEdgeOutputId(e);
        const traversal = deriveEdgeTraversal(e.source, e.target, activeOverlay);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // Phase 11: route by ``output_id`` (the stable handle id). The
          // visible edge label uses the descriptor's display label for
          // that output id when we can find it.
          sourceHandle: outputId,
          label: descriptorEdgeLabel(palette, e.source, outputId, nodes),
          ...(traversal ?? {}),
        };
      }),
    [edges, palette, nodes, activeOverlay],
  );

  // ReactFlow's ``onInit`` fires once nodes are placed in the layout.
  // Centering the canvas at this point avoids the race that
  // ``fitView`` + a follow-up ``setViewport`` effect produced (the latter
  // could overwrite the auto-fit before nodes were measured, leaving the
  // graph anchored to the upper-left). When the workflow has a persisted
  // viewport we restore it; otherwise we fit to nodes with a margin.
  const onInit = useCallback((rf: ReactFlowInstance) => {
    const saved = useWorkflowBuilderStore.getState().viewport;
    if (saved) {
      rf.setViewport(saved);
    } else {
      rf.fitView({ padding: 0.2 });
    }
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
    const editable = s.viewMode === 'edit';
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        // Position changes are layout-only and Phase 14 routes them through
        // a separate hash, so they're allowed in view mode too — but in
        // practice React Flow's drag handles only fire when interactive
        // mode is on, which we gate via the `nodesDraggable` prop below.
        s.updateNodePosition(c.id, c.position);
      } else if (c.type === 'remove') {
        if (!editable) continue;
        s.removeNode(c.id);
      }
      // ``select`` changes are intentionally ignored — Zustand owns the
      // selection (see ``onNodeClick`` and ``onPaneClick``); RF's own
      // selection state is mirrored onto each node via the ``selected``
      // field in ``rfNodes`` above.
    }
  }, []);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    useWorkflowBuilderStore.getState().setSelectedNode(node.id);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
    if (s.viewMode !== 'edit') return;
    for (const c of changes) {
      if (c.type === 'remove') s.removeEdge(c.id);
    }
  }, []);

  const onPaneClick = useCallback(() => {
    // Clicking the empty canvas deselects, which unmounts the inspector rail.
    // ReactFlow will not fire onPaneClick when a node-click is handled, so
    // this is safe alongside the node-select path in onNodesChange.
    useWorkflowBuilderStore.getState().clearSelection();
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    const s = useWorkflowBuilderStore.getState();
    if (s.viewMode !== 'edit') return;
    if (!conn.source || !conn.target) return;
    // Phase 11: persist the canonical snake_case ``output_id`` (matches
    // the JSONB blob and the backend's ``WorkflowDefinitionEdge`` shape).
    // Earlier builds wrote ``outputId``; both still hydrate via
    // ``getEdgeOutputId``.
    s.addEdge({
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: conn.source,
      target: conn.target,
      output_id: conn.sourceHandle ?? 'default',
    });
  }, []);

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      // Persist viewport in store so the next reload reopens at the user's
      // last pan/zoom. setViewport does NOT mark the draft dirty.
      useWorkflowBuilderStore.getState().setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      });
    },
    [],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const s = useWorkflowBuilderStore.getState();
      if (s.viewMode !== 'edit') return;
      const dataStr = event.dataTransfer.getData('application/orchestration-node');
      if (!dataStr) return;
      let desc: NodeTypeDescriptor;
      try {
        desc = JSON.parse(dataStr) as NodeTypeDescriptor;
      } catch {
        return;
      }
      // Convert browser-coords (event.clientX/Y) to React Flow's transformed
      // pane-coords. Bare bounds-math drops nodes in the wrong place under
      // any pan/zoom; screenToFlowPosition is the React Flow primitive that
      // handles the coordinate transform.
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      useWorkflowBuilderStore.getState().addNode({
        id: `${desc.nodeType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: desc.nodeType,
        position,
        data: { label: desc.displayLabel ?? desc.label, nodeType: desc.nodeType },
        config: {},
      });
    },
    [reactFlow],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div ref={wrapperRef} className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        onPaneClick={onPaneClick}
        // Phase-14 follow-up — view mode locks every write affordance at
        // the React Flow layer so the cursor and handle highlights match
        // the disabled state. Click-to-select still works.
        nodesDraggable={isEdit}
        nodesConnectable={isEdit}
        edgesFocusable={isEdit}
        elementsSelectable
        // ReactFlow's "powered by" badge is overlaid on the bottom-right.
        // Hidden so the canvas reads as part of the product chrome.
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls
          showInteractive={false}
          // Dark-mode legibility: ReactFlow's default control buttons use
          // baked-in #fefefe / #555 values. Override against design tokens
          // so light + dark both look right without per-theme overrides
          // in globals.css.
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-default)',
            color: 'var(--text-primary)',
          }}
        />
        <MiniMap
          pannable
          zoomable
          ariaLabel="Workflow minimap"
          // SVG `fill` attribute does not resolve CSS variables across all
          // browsers — and React Flow's MiniMap reads `nodeColor` straight
          // into a `<rect fill={...}>`. Resolve to computed hex up-front
          // so nodes actually render in the minimap. Pull the accent
          // token via the central category resolver so palette + canvas
          // + minimap stay in lockstep when categories change.
          nodeColor={(n) => {
            const data = n.data as
              | { displayCategory?: string; category?: string }
              | undefined;
            return resolveColor(getCategoryAccentToken(data ?? {}));
          }}
          nodeStrokeColor={resolveColor('var(--bg-elevated)')}
          nodeStrokeWidth={2}
          nodeBorderRadius={3}
          maskColor={resolveColor('var(--bg-overlay)')}
        />
      </ReactFlow>
    </div>
  );
}
