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
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, type DragEvent } from 'react';
import '@xyflow/react/dist/style.css';

import { getCategoryAccentToken } from '@/features/orchestration/config/categories';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import {
  getEdgeOutputId,
  type NodeTypeDescriptor,
  type WorkflowDefinitionNode,
} from '@/features/orchestration/types';
import { resolveColor } from '@/utils/statusColors';
import { CustomNode } from './CustomNode';

const nodeTypes = { custom: CustomNode };

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

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

function CanvasInner() {
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  const edges = useWorkflowBuilderStore((s) => s.edges);
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const savedViewport = useWorkflowBuilderStore((s) => s.viewport);

  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Track whether we've already restored the saved viewport; one-shot per mount
  // so a later store update during the same session doesn't snap-back the user's
  // manual pan/zoom.
  const viewportRestored = useRef(false);

  const rfNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const desc = palette.find((p) => p.nodeType === n.type);
        return {
          id: n.id,
          type: 'custom',
          position: n.position,
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
          },
        };
      }),
    [nodes, palette],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const outputId = getEdgeOutputId(e);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          // Phase 11: route by ``output_id`` (the stable handle id). The
          // visible edge label uses the descriptor's display label for
          // that output id when we can find it.
          sourceHandle: outputId,
          label: descriptorEdgeLabel(palette, e.source, outputId, nodes),
        };
      }),
    [edges, palette, nodes],
  );

  // Restore saved viewport once the ReactFlow instance is ready. Falls back to
  // fitView (via the ReactFlow `fitView` prop below) when no viewport exists.
  useEffect(() => {
    if (viewportRestored.current) return;
    if (!savedViewport) return;
    reactFlow.setViewport(savedViewport);
    viewportRestored.current = true;
  }, [savedViewport, reactFlow]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        s.updateNodePosition(c.id, c.position);
      } else if (c.type === 'remove') {
        s.removeNode(c.id);
      } else if (c.type === 'select') {
        s.setSelectedNode(c.selected ? c.id : null);
      }
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const s = useWorkflowBuilderStore.getState();
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
    if (!conn.source || !conn.target) return;
    // Phase 11: persist the canonical ``outputId`` instead of the legacy
    // ``label``. The handle id IS the output id (set on the React Flow
    // Handle via ``id={oid}`` in CustomNode).
    s.addEdge({
      id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: conn.source,
      target: conn.target,
      outputId: conn.sourceHandle ?? 'default',
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onMoveEnd={onMoveEnd}
        onPaneClick={onPaneClick}
        // Only autofit when there's no saved viewport; once the user has
        // panned/zoomed at least once, restoring fitView would discard that.
        fitView={savedViewport == null}
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
