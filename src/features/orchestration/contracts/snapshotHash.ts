import type {
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
} from '@/features/orchestration/types';

/**
 * Phase 14 — stable structural hashes used by the lifecycle state machine.
 *
 * Two hashes:
 *   - `dataSnapshotHash`: identity of the workflow's *content* — every node's
 *     id/type/config and every edge's id/source/target/output_id. Position
 *     and viewport are intentionally excluded so dragging or panning never
 *     contributes to "unsaved edits".
 *   - `layoutSnapshotHash`: identity of node positions only. Layout changes
 *     still need to round-trip on the next user-clicked Save (the existing
 *     versioning model carries them), but they don't drive the lifecycle
 *     pill's `dirty-published-edits` state.
 *
 * Implementation: deterministic JSON serialisation of a normalized object.
 * Plain JS, no library — orchestration definitions are small (low hundreds
 * of nodes), so the cost of `JSON.stringify` here is negligible compared to
 * a render. Strings double as the canonical equality key for two snapshots.
 */

interface NormalizedNode {
  id: string;
  type: string;
  config: unknown;
  data: unknown;
}

interface NormalizedEdge {
  id: string;
  source: string;
  target: string;
  output_id?: string;
}

function normalizeNodeForData(node: WorkflowDefinitionNode): NormalizedNode {
  return {
    id: node.id,
    type: node.type,
    config: canonicalize(node.config),
    data: canonicalize(node.data),
  };
}

function normalizeEdgeForData(edge: WorkflowDefinitionEdge): NormalizedEdge {
  // Accept either the canonical `output_id` or the legacy aliases (`outputId`,
  // `label`) so a freshly-loaded workflow whose persisted shape uses one
  // alias produces the same hash as the same workflow after a save that
  // upgrades it. Without this, hydrate alone would dirty the snapshot.
  const outputId = edge.output_id ?? edge.outputId ?? edge.label ?? undefined;
  const out: NormalizedEdge = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  };
  if (outputId !== undefined) out.output_id = outputId;
  return out;
}

/** Recursively sort object keys so `{a:1,b:2}` and `{b:2,a:1}` hash the
 *  same. Arrays preserve order (semantically meaningful for branches). */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) out[k] = canonicalize(obj[k]);
  return out;
}

export function dataSnapshotHash(
  nodes: ReadonlyArray<WorkflowDefinitionNode>,
  edges: ReadonlyArray<WorkflowDefinitionEdge>,
): string {
  const sortedNodes = nodes
    .map(normalizeNodeForData)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedEdges = edges
    .map(normalizeEdgeForData)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({ nodes: sortedNodes, edges: sortedEdges });
}

export function layoutSnapshotHash(
  nodes: ReadonlyArray<WorkflowDefinitionNode>,
): string {
  const positions = nodes
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(positions);
}
