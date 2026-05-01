import { create } from 'zustand';

import type {
  NodeTypeDescriptor,
  WorkflowDefinition,
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
} from '@/features/orchestration/types';

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface WorkflowBuilderState {
  workflowId: string | null;
  versionId: string | null;
  workflowName: string;
  workflowType: 'crm' | 'clinical' | null;
  /** Latest published version on this workflow, or null when never published.
   *  Used by the header to disable Run Now until publish has happened, and to
   *  show a Draft / Published affordance instead of relying on a backend 400. */
  currentPublishedVersionId: string | null;

  nodes: WorkflowDefinitionNode[];
  edges: WorkflowDefinitionEdge[];
  selectedNodeId: string | null;
  /** Persisted React Flow viewport — null until first load/move-end. */
  viewport: ViewportState | null;
  dirty: boolean;

  paletteCatalog: NodeTypeDescriptor[];
  paletteLoading: boolean;
  /** Whether the left rail is collapsed to its compact icon-only state.
   *  Persists for the lifetime of the store instance so toggling the
   *  inspector or panning the canvas doesn't reset the rail. */
  paletteCollapsed: boolean;
  /** Node id queued for deletion confirmation. The builder page renders
   *  a `ConfirmDialog` against this slot so per-card delete buttons
   *  never trigger a destructive action without an explicit yes. Cleared
   *  on confirm or cancel. */
  pendingDeleteNodeId: string | null;

  reset(): void;
  hydrate(definition: WorkflowDefinition): void;
  setMetadata(meta: {
    workflowId: string;
    versionId: string | null;
    name: string;
    workflowType: 'crm' | 'clinical';
    currentPublishedVersionId?: string | null;
  }): void;
  setCurrentPublishedVersionId(versionId: string | null): void;
  setPaletteCatalog(catalog: NodeTypeDescriptor[]): void;
  setPaletteLoading(loading: boolean): void;
  setPaletteCollapsed(collapsed: boolean): void;
  requestDeleteNode(nodeId: string): void;
  cancelDeleteNode(): void;

  addNode(node: WorkflowDefinitionNode): void;
  updateNodePosition(nodeId: string, position: { x: number; y: number }): void;
  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void;
  removeNode(nodeId: string): void;

  addEdge(edge: WorkflowDefinitionEdge): void;
  removeEdge(edgeId: string): void;

  setSelectedNode(nodeId: string | null): void;
  /** Clear the current selection. Equivalent to setSelectedNode(null) but
   *  expressed as its own action so callers (Canvas pane click, ESC handler,
   *  inspector close button) read intent at the call site. */
  clearSelection(): void;
  setViewport(viewport: ViewportState | null): void;

  toDefinition(): WorkflowDefinition;
}

// Phase 11 (Commit 2): the legacy ``syncSourceNodeNextEdges`` /
// ``isSourceNodeType`` helpers were removed. Source-node successors come
// from the outgoing ``default`` edge — the backend normalizer
// (``definition_normalizer._normalize_cohort_query_node`` /
// ``_normalize_event_trigger_node``) strips ``next_node_id`` from saved
// definitions, and the validator requires exactly one outgoing
// ``default`` edge on every ``source.*`` node before publish. Writing
// ``next_node_id`` from the frontend was redundant noise.

export const useWorkflowBuilderStore = create<WorkflowBuilderState>((set, get) => ({
  workflowId: null,
  versionId: null,
  workflowName: '',
  workflowType: null,
  currentPublishedVersionId: null,

  nodes: [],
  edges: [],
  selectedNodeId: null,
  viewport: null,
  dirty: false,

  paletteCatalog: [],
  paletteLoading: false,
  paletteCollapsed: false,
  pendingDeleteNodeId: null,

  reset: () =>
    set({
      workflowId: null,
      versionId: null,
      workflowName: '',
      workflowType: null,
      currentPublishedVersionId: null,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      viewport: null,
      dirty: false,
    }),

  hydrate: (definition) =>
    set({
      nodes: definition.nodes ?? [],
      edges: definition.edges ?? [],
      viewport: definition.canvas?.viewport ?? null,
      dirty: false,
      selectedNodeId: null,
    }),

  setMetadata: (meta) =>
    set({
      workflowId: meta.workflowId,
      versionId: meta.versionId,
      workflowName: meta.name,
      workflowType: meta.workflowType,
      currentPublishedVersionId:
        meta.currentPublishedVersionId !== undefined
          ? meta.currentPublishedVersionId
          : get().currentPublishedVersionId,
    }),

  setCurrentPublishedVersionId: (versionId) =>
    set({ currentPublishedVersionId: versionId }),

  setPaletteCatalog: (catalog) => set({ paletteCatalog: catalog }),
  setPaletteLoading: (loading) => set({ paletteLoading: loading }),
  setPaletteCollapsed: (collapsed) => set({ paletteCollapsed: collapsed }),
  requestDeleteNode: (nodeId) => set({ pendingDeleteNodeId: nodeId }),
  cancelDeleteNode: () => set({ pendingDeleteNodeId: null }),

  addNode: (node) =>
    set((s) => ({
      nodes: [...s.nodes, node],
      dirty: true,
    })),

  updateNodePosition: (nodeId, position) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      dirty: true,
    })),

  updateNodeConfig: (nodeId, config) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)),
      dirty: true,
    })),

  removeNode: (nodeId) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      dirty: true,
    })),

  addEdge: (edge) =>
    set((s) => ({
      edges: [...s.edges, edge],
      dirty: true,
    })),

  removeEdge: (edgeId) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== edgeId),
      dirty: true,
    })),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  clearSelection: () => set({ selectedNodeId: null }),

  setViewport: (viewport) => {
    // Updating the viewport must NOT flip dirty; pan/zoom are presentation-
    // only state. Without this guard every wheel-scroll would mark the draft
    // unsaved and re-enable the Save button.
    set({ viewport });
  },

  toDefinition: () => {
    const s = get();
    const definition: WorkflowDefinition = {
      nodes: s.nodes,
      edges: s.edges,
    };
    if (s.viewport) {
      definition.canvas = { viewport: s.viewport };
    }
    return definition;
  },
}));
