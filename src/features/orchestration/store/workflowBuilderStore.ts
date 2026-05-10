import { useMemo } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import type {
  NodeTypeDescriptor,
  WorkflowDefinition,
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
} from "@/features/orchestration/types";
import {
  dataSnapshotHash,
  layoutSnapshotHash,
} from "@/features/orchestration/contracts/snapshotHash";
import {
  deriveLifecycleState,
  type InFlight,
  type LifecycleState,
  type PublishOutcome,
  type SaveOutcome,
} from "@/features/orchestration/contracts/lifecycleState";
import { parseNodeConfig } from "@/features/orchestration/contracts/nodeConfig";
import type { FieldErrorItem } from "@/features/orchestration/contracts/errorDecoder";
import { logger } from "@/services/logger";

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

type HydrateMode = "load" | "rebase";

/**
 * Phase 14 — derived lifecycle replaces the boolean `dirty` flag.
 *
 * Previously the store carried a single `dirty: boolean` toggled by every
 * mutator (including position updates). The header pill, save toast, and
 * button enabled-state all read it directly, conflating layout changes
 * with content changes and erasing failure context.
 *
 * Now: every content mutator recomputes `currentDataHash` (id/type/config
 * + edges, never position). Position-only mutators recompute
 * `currentLayoutHash` instead. `committedDataHash` / `committedLayoutHash`
 * are stamped on hydrate / save / publish. The lifecycle state is derived
 * from those four hashes plus `inFlight` + `lastSaveOutcome` +
 * `lastPublishOutcome` via `deriveLifecycleState`.
 *
 * The header reads `useLifecycleState()` (a selector defined below) and
 * never re-implements the discriminator.
 */
interface WorkflowBuilderState {
  workflowId: string | null;
  versionId: string | null;
  workflowName: string;
  workflowType: "crm" | "clinical" | null;
  /** Latest published version on this workflow, or null when never published.
   *  Used by the header to disable Run Now until publish has happened, and to
   *  show a Draft / Published affordance instead of relying on a backend 400. */
  currentPublishedVersionId: string | null;

  nodes: WorkflowDefinitionNode[];
  edges: WorkflowDefinitionEdge[];
  selectedNodeId: string | null;
  /** Persisted React Flow viewport — null until first load/move-end. */
  viewport: ViewportState | null;

  /** Hash of the most recently committed data snapshot (set on hydrate /
   *  successful save). `null` only between `reset()` and the first hydrate. */
  committedDataHash: string | null;
  /** Hash of the live data snapshot (recomputed by every content mutator). */
  currentDataHash: string;
  /** Hash of the most recently committed layout (positions only). */
  committedLayoutHash: string | null;
  /** Hash of the live layout snapshot (recomputed by `updateNodePosition`,
   *  `addNode`, `removeNode`). Viewport is excluded entirely — pan/zoom is
   *  presentation-only state and must never affect either hash. */
  currentLayoutHash: string;

  inFlight: InFlight;
  lastSaveOutcome: SaveOutcome | null;
  lastPublishOutcome: PublishOutcome | null;

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

  /** Phase 14 follow-up — view-vs-edit gating for the builder.
   *
   *  Default `'view'` on every fresh hydrate so landing on a published
   *  workflow can't be accidentally mutated. Operator clicks an explicit
   *  Edit button to enter `'edit'`; back-out (with leave-confirm if
   *  dirty) is the only exit (per the workflow-builder UX research:
   *  n8n / Zapier / GitHub Actions all use this two-state model and none
   *  introduces a separate "exit edit mode" button — back navigates).
   *
   *  Rebase-mode hydrate (the post-save round-trip) preserves the
   *  current `viewMode` so a save inside edit doesn't kick the user
   *  out. Load-mode hydrate (a fresh workflow open) always resets to
   *  `'view'`. */
  viewMode: "view" | "edit";

  reset(): void;
  hydrate(
    definition: WorkflowDefinition,
    options?: { mode?: HydrateMode },
  ): void;
  setMetadata(meta: {
    workflowId: string;
    versionId: string | null;
    name: string;
    workflowType: "crm" | "clinical";
    currentPublishedVersionId?: string | null;
  }): void;
  setCurrentPublishedVersionId(versionId: string | null): void;
  setPaletteCatalog(catalog: NodeTypeDescriptor[]): void;
  setPaletteLoading(loading: boolean): void;
  setPaletteCollapsed(collapsed: boolean): void;
  requestDeleteNode(nodeId: string): void;
  cancelDeleteNode(): void;
  /** Toggle between view-only and edit modes. Edit unlocks palette,
   *  drag-drop, edge-connect, per-node delete, and the inspector form
   *  inputs. View hides those affordances and renders the inspector
   *  read-only. */
  setViewMode(mode: "view" | "edit"): void;

  addNode(node: WorkflowDefinitionNode): void;
  updateNodePosition(nodeId: string, position: { x: number; y: number }): void;
  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void;
  removeNode(nodeId: string): void;

  addEdge(edge: WorkflowDefinitionEdge): void;
  removeEdge(edgeId: string): void;

  /** Phase 2 (sherlock-builder) — batch mutations used by the canvas-patch
   *  applier. Hash recomputation runs ONCE at the end of the batch (one
   *  React commit, one `currentDataHash` change) instead of N. Each node
   *  still passes through `annotateNodeWithParse` so per-node `_parseIssues`
   *  surface in the banner exactly as if the user had added them one by one. */
  addNodes(nodes: readonly WorkflowDefinitionNode[]): void;
  addEdges(edges: readonly WorkflowDefinitionEdge[]): void;

  setSelectedNode(nodeId: string | null): void;
  /** Clear the current selection. Equivalent to setSelectedNode(null) but
   *  expressed as its own action so callers (Canvas pane click, ESC handler,
   *  inspector close button) read intent at the call site. */
  clearSelection(): void;
  setViewport(viewport: ViewportState | null): void;

  /** Mark that a save/publish is in flight. Lifecycle derivation routes
   *  through `inFlight` rather than racing toasts. */
  beginInFlight(kind: "saving" | "publishing"): void;
  /** Record the outcome of the most recent save. On success, advances the
   *  committed hashes so the lifecycle pill flips clean. */
  finishSave(outcome: SaveOutcome): void;
  /** Record the outcome of the most recent publish. */
  finishPublish(outcome: PublishOutcome): void;

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

const EMPTY_DATA_HASH = dataSnapshotHash([], []);
const EMPTY_LAYOUT_HASH = layoutSnapshotHash([]);

/** Run a node's config through the Phase D Zod parse boundary. Returns the
 *  same node when the config parses cleanly (with `_parseIssues` cleared
 *  if it was set previously); returns a node with `_parseIssues` populated
 *  when the config fails. The store uses draft-authoring mode here so
 *  omitted required fields on incomplete drafts do not surface as parse
 *  drift; unknown keys and wrong types still do. The store always writes —
 *  log+continue mode keeps the builder usable while the issues banner
 *  surfaces what's wrong. */
function annotateNodeWithParse(
  node: WorkflowDefinitionNode,
): WorkflowDefinitionNode {
  const result = parseNodeConfig(node.type, node.config, { mode: "draft" });
  if (result.ok) {
    if (node._parseIssues && node._parseIssues.length === 0) return node;
    if (!node._parseIssues) return node;
      const rest = { ...node };
      delete rest._parseIssues;
      return rest;
  }
  return { ...node, _parseIssues: result.issues };
}

function annotateNodesWithParse(
  nodes: readonly WorkflowDefinitionNode[],
): WorkflowDefinitionNode[] {
  return nodes.map(annotateNodeWithParse);
}

export const useWorkflowBuilderStore = create<WorkflowBuilderState>(
  (set, get) => ({
    workflowId: null,
    versionId: null,
    workflowName: "",
    workflowType: null,
    currentPublishedVersionId: null,

    nodes: [],
    edges: [],
    selectedNodeId: null,
    viewport: null,

    committedDataHash: null,
    currentDataHash: EMPTY_DATA_HASH,
    committedLayoutHash: null,
    currentLayoutHash: EMPTY_LAYOUT_HASH,

    inFlight: "idle",
    lastSaveOutcome: null,
    lastPublishOutcome: null,

    paletteCatalog: [],
    paletteLoading: false,
    paletteCollapsed: false,
    pendingDeleteNodeId: null,
    viewMode: "view",

    reset: () =>
      set({
        workflowId: null,
        versionId: null,
        workflowName: "",
        workflowType: null,
        currentPublishedVersionId: null,
        nodes: [],
        edges: [],
        selectedNodeId: null,
        viewport: null,
        committedDataHash: null,
        currentDataHash: EMPTY_DATA_HASH,
        committedLayoutHash: null,
        currentLayoutHash: EMPTY_LAYOUT_HASH,
        inFlight: "idle",
        lastSaveOutcome: null,
        lastPublishOutcome: null,
        viewMode: "view",
      }),

    hydrate: (definition, options) => {
      const previous = get();
      const mode = options?.mode ?? "load";
      // Phase 14 / D4 — every node config crosses the parse boundary at
      // hydrate. Failures attach `_parseIssues` to the node so the canvas
      // banner can surface them; we never silently drop config keys.
      const rawNodes = definition.nodes ?? [];
      const nodes = annotateNodesWithParse(rawNodes);
      const issueCount = nodes.reduce(
        (acc, n) => acc + (n._parseIssues?.length ?? 0),
        0,
      );
      if (issueCount > 0) {
        logger.warn("orchestration.workflowBuilderStore.hydrate", {
          message: "node config parse issues detected",
          issueCount,
          nodeIds: nodes
            .filter((n) => n._parseIssues && n._parseIssues.length > 0)
            .map((n) => n.id),
        });
      }
      const edges = definition.edges ?? [];
      const dHash = dataSnapshotHash(nodes, edges);
      const lHash = layoutSnapshotHash(nodes);
      const selectedNodeId =
        mode === "rebase" &&
        previous.selectedNodeId &&
        nodes.some((n) => n.id === previous.selectedNodeId)
          ? previous.selectedNodeId
          : null;
      set({
        nodes,
        edges,
        viewport: definition.canvas?.viewport ?? null,
        selectedNodeId,
        committedDataHash: dHash,
        currentDataHash: dHash,
        committedLayoutHash: lHash,
        currentLayoutHash: lHash,
        // A full load clears transient UI/write state. A server rebase after a
        // save keeps the current in-flight/outcome surface intact so a publish
        // that auto-saves first does not briefly fall back to "idle".
        lastSaveOutcome: mode === "rebase" ? previous.lastSaveOutcome : null,
        lastPublishOutcome:
          mode === "rebase" ? previous.lastPublishOutcome : null,
        inFlight: mode === "rebase" ? previous.inFlight : "idle",
        // Fresh open lands in view mode so a published workflow can't be
        // mutated by accident. Rebase preserves the current mode so a
        // mid-edit save doesn't kick the operator back to view.
        viewMode: mode === "rebase" ? previous.viewMode : "view",
      });
    },

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

    setViewMode: (mode) => set({ viewMode: mode }),

    addNode: (node) =>
      set((s) => {
        const annotated = annotateNodeWithParse(node);
        const nodes = [...s.nodes, annotated];
        return {
          nodes,
          currentDataHash: dataSnapshotHash(nodes, s.edges),
          currentLayoutHash: layoutSnapshotHash(nodes),
        };
      }),

    updateNodePosition: (nodeId, position) =>
      set((s) => {
        const nodes = s.nodes.map((n) =>
          n.id === nodeId ? { ...n, position } : n,
        );
        // Position-only changes recompute layout hash, NOT data hash. The
        // lifecycle state machine ignores layout when computing
        // `dirty-published-edits` so dragging a node never flips the pill.
        return {
          nodes,
          currentLayoutHash: layoutSnapshotHash(nodes),
        };
      }),

    updateNodeConfig: (nodeId, config) =>
      set((s) => {
        // Phase 14 / D5 — log+continue mode. Run the new config through the
        // parse boundary; on success swap the canonicalised (transformed)
        // value into the store so editors see normalised shapes (e.g. split
        // branches pruned to the active mode). On failure, write the raw
        // value through and annotate the node with `_parseIssues` so the
        // canvas banner surfaces what's wrong without blocking the user.
        const nodes = s.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const result = parseNodeConfig(n.type, config, { mode: "draft" });
          if (result.ok) {
          if (n._parseIssues && n._parseIssues.length > 0) {
            const rest = { ...n };
            delete rest._parseIssues;
            return { ...rest, config: result.data };
          }
            return { ...n, config: result.data };
          }
          logger.warn("orchestration.workflowBuilderStore.updateNodeConfig", {
            message:
              "node config parse issues — writing raw value (log+continue)",
            nodeId,
            nodeType: n.type,
            issues: result.issues,
          });
          return { ...n, config, _parseIssues: result.issues };
        });
        return {
          nodes,
          currentDataHash: dataSnapshotHash(nodes, s.edges),
        };
      }),

    removeNode: (nodeId) =>
      set((s) => {
        const nodes = s.nodes.filter((n) => n.id !== nodeId);
        const edges = s.edges.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        );
        return {
          nodes,
          edges,
          selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
          currentDataHash: dataSnapshotHash(nodes, edges),
          currentLayoutHash: layoutSnapshotHash(nodes),
        };
      }),

    addEdge: (edge) =>
      set((s) => {
        const edges = [...s.edges, edge];
        return {
          edges,
          currentDataHash: dataSnapshotHash(s.nodes, edges),
        };
      }),

    addNodes: (newNodes) =>
      set((s) => {
        if (newNodes.length === 0) return {};
        const annotated = newNodes.map(annotateNodeWithParse);
        const nodes = [...s.nodes, ...annotated];
        return {
          nodes,
          currentDataHash: dataSnapshotHash(nodes, s.edges),
          currentLayoutHash: layoutSnapshotHash(nodes),
        };
      }),

    addEdges: (newEdges) =>
      set((s) => {
        if (newEdges.length === 0) return {};
        const edges = [...s.edges, ...newEdges];
        return {
          edges,
          currentDataHash: dataSnapshotHash(s.nodes, edges),
        };
      }),

    removeEdge: (edgeId) =>
      set((s) => {
        const edges = s.edges.filter((e) => e.id !== edgeId);
        return {
          edges,
          currentDataHash: dataSnapshotHash(s.nodes, edges),
        };
      }),

    setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

    clearSelection: () => set({ selectedNodeId: null }),

    setViewport: (viewport) => {
      // Updating the viewport must NOT flip dirty; pan/zoom are presentation-
      // only state. The lifecycle machine reads only data + layout hashes;
      // viewport is intentionally excluded from both.
      set({ viewport });
    },

    beginInFlight: (kind) =>
      set({
        inFlight: kind,
        // Clear the last outcome of the same kind — the new attempt supersedes
        // the previous failure surface. Outcomes from the *other* kind stay so
        // a save success doesn't erase a publish-failed pill.
        lastSaveOutcome: kind === "saving" ? null : get().lastSaveOutcome,
        lastPublishOutcome:
          kind === "publishing" ? null : get().lastPublishOutcome,
      }),

    finishSave: (outcome) =>
      set((s) => {
        if (outcome.status === "ok") {
          return {
            inFlight: "idle",
            lastSaveOutcome: outcome,
            committedDataHash: s.currentDataHash,
            committedLayoutHash: s.currentLayoutHash,
          };
        }
        return { inFlight: "idle", lastSaveOutcome: outcome };
      }),

    finishPublish: (outcome) =>
      set({ inFlight: "idle", lastPublishOutcome: outcome }),

    toDefinition: () => {
      const s = get();
      // Strip the FE-only `_parseIssues` annotation before the definition
      // crosses the wire — it's a UI hint, not part of the stored schema.
    const cleanNodes = s.nodes.map((n) => {
      if (!n._parseIssues) return n;
      const rest = { ...n };
      delete rest._parseIssues;
      return rest;
    });
      const definition: WorkflowDefinition = {
        nodes: cleanNodes,
        edges: s.edges,
      };
      if (s.viewport) {
        definition.canvas = { viewport: s.viewport };
      }
      return definition;
    },
  }),
);

/** Phase 14 / Phase E — derives `nodeId -> FieldErrorItem[]` from the
 *  `lastPublishOutcome` so the canvas can decorate the offending nodes
 *  with a red badge.
 *
 *  Pure helper — usable from tests directly. `usePublishErrorsByNodeId`
 *  composes this with React `useMemo` over a stable Zustand selector. */
export function selectPublishErrorsByNodeId(
  outcome: PublishOutcome | null,
): Record<string, FieldErrorItem[]> {
  if (!outcome || outcome.status !== "fail") return EMPTY_PUBLISH_ERRORS;
  if (outcome.error.kind !== "fieldErrors") return EMPTY_PUBLISH_ERRORS;
  const grouped: Record<string, FieldErrorItem[]> = {};
  for (const item of outcome.error.items) {
    if (!item.nodeId) continue;
    (grouped[item.nodeId] ||= []).push(item);
  }
  return grouped;
}

const EMPTY_PUBLISH_ERRORS: Record<string, FieldErrorItem[]> = Object.freeze(
  {},
);

/** Pull the raw outcome via Zustand (returns a stable reference until the
 *  outcome itself changes) and derive the grouped shape on the React side
 *  via `useMemo`. **Do not** group inside a Zustand selector wrapped in
 *  `useShallow` — the grouped object would be a fresh reference per
 *  selector call (with fresh inner arrays), and `useShallow`'s shallow
 *  comparison cannot dedupe those. React's `useSyncExternalStore` then
 *  flags fresh-snapshot-during-render as store tearing and infinite-loops
 *  the consumer. Keep selectors returning store-owned references only. */
export function usePublishErrorsByNodeId(): Record<string, FieldErrorItem[]> {
  const outcome = useWorkflowBuilderStore((s) => s.lastPublishOutcome);
  return useMemo(() => selectPublishErrorsByNodeId(outcome), [outcome]);
}

/** Pure helper for the parse-issue banner. Filters down to nodes carrying
 *  `_parseIssues` and surfaces the summary tuple the banner renders. */
export function selectNodeParseIssueSummary(
  nodes: readonly WorkflowDefinitionNode[],
): Array<{
  nodeId: string;
  nodeType: string;
  issues: NonNullable<WorkflowDefinitionNode["_parseIssues"]>;
}> {
  const out: Array<{
    nodeId: string;
    nodeType: string;
    issues: NonNullable<WorkflowDefinitionNode["_parseIssues"]>;
  }> = [];
  for (const n of nodes) {
    if (n._parseIssues && n._parseIssues.length > 0) {
      out.push({ nodeId: n.id, nodeType: n.type, issues: n._parseIssues });
    }
  }
  return out;
}

/** Banner-friendly summary of `_parseIssues` across the live nodes.
 *
 *  Implementation note: the Zustand selector returns the raw `nodes`
 *  array (a stable reference until any node mutates), and the grouping
 *  is memoised on the React side via `useMemo`. An earlier version
 *  inlined the grouping inside `useShallow` — that produced a fresh
 *  array of fresh objects per selector call, which `useShallow`'s
 *  shallow-equality could not cache. React's `useSyncExternalStore`
 *  detected the fresh-snapshot-during-render as store tearing and
 *  infinite-looped the consumer. See PublishErrorSurfacing tests for
 *  regression coverage. */
export function useNodeParseIssueSummary(): ReturnType<
  typeof selectNodeParseIssueSummary
> {
  const nodes = useWorkflowBuilderStore((s) => s.nodes);
  return useMemo(() => selectNodeParseIssueSummary(nodes), [nodes]);
}

/** Selector hook: derives the lifecycle state machine on every relevant
 *  store change. Header / pill / button enabled-state read this; nothing
 *  else should reach into the underlying snapshot fields directly.
 *
 *  Implementation note: the Zustand selector returns each individual
 *  primitive / store-owned reference (`useShallow` over an object of
 *  primitives caches cleanly), and the discriminated-union derivation
 *  happens on the React side via `useMemo`. An earlier version inlined
 *  `deriveLifecycleState` inside `useShallow` — but `deriveLifecycleState`
 *  returns a fresh `LifecycleState` object on every call. `useShallow`
 *  on objects compares keys + direct values: two `{kind:'clean-draft'}`
 *  objects compare shallow-equal, so the simple branches are fine, but
 *  any branch that returns `{kind:'save-failed', error: <fresh body>}`
 *  with a fresh nested object trips shallow-equality and produces a
 *  different reference per selector call. React's `useSyncExternalStore`
 *  flags fresh-snapshot-during-render as tearing → infinite update loop.
 *  Keep Zustand selectors returning store-owned references only. */
export function useLifecycleState(): LifecycleState {
  const inputs = useWorkflowBuilderStore(
    useShallow((s) => ({
      hasPublishedVersion: Boolean(s.currentPublishedVersionId),
      committedDataHash: s.committedDataHash,
      currentDataHash: s.currentDataHash,
      committedLayoutHash: s.committedLayoutHash,
      currentLayoutHash: s.currentLayoutHash,
      inFlight: s.inFlight,
      lastSaveOutcome: s.lastSaveOutcome,
      lastPublishOutcome: s.lastPublishOutcome,
    })),
  );
  return useMemo(() => deriveLifecycleState(inputs), [inputs]);
}
