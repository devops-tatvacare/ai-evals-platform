import { Handle, Position, type NodeProps } from '@xyflow/react';

import { getCategoryDef } from '@/features/orchestration/config/categories';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import { NodeCard } from './NodeCard';

export type NodeOverlayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeOverlay {
  status: NodeOverlayStatus;
  cohortSize?: number;
}

export interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  /** Phase 11 (Commit 2) — neutral functional category used for tokens
   *  + minimap. Falls back to the legacy ``category`` when missing for
   *  back-compat with older saved-state restoration paths. */
  displayCategory?: string;
  /** Legacy bucket — preserved alongside ``displayCategory`` so older
   *  consumers (the run-canvas overlay still passes ``category`` through)
   *  keep rendering. New code should prefer ``displayCategory``. */
  category: string;
  description?: string;
  outputEdges: string[];
  /** Optional id-to-label map for the outgoing handles. When set, the
   *  Canvas card renders the human label as a small pill near the
   *  handle; otherwise the handle stays unlabeled. */
  outputEdgeLabels?: Record<string, string>;
  /** Optional run-view overlay. When present, renders a status pill +
   *  cohort-size badge. Set by the run canvas only — never the builder. */
  overlay?: NodeOverlay;
}

function asOverlay(value: unknown): NodeOverlay | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const status = v.status;
  if (
    status !== 'pending' &&
    status !== 'running' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'skipped'
  ) {
    return undefined;
  }
  return {
    status,
    cohortSize: typeof v.cohortSize === 'number' ? v.cohortSize : undefined,
  };
}

function asCustomData(value: unknown): CustomNodeData {
  const fallback: CustomNodeData = {
    label: '',
    nodeType: '',
    category: 'logic',
    outputEdges: ['default'],
  };
  if (!value || typeof value !== 'object') return fallback;
  const v = value as Record<string, unknown>;
  const outputEdgeLabels =
    v.outputEdgeLabels && typeof v.outputEdgeLabels === 'object'
      ? (Object.fromEntries(
          Object.entries(v.outputEdgeLabels as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ) as Record<string, string>)
      : undefined;
  return {
    label: typeof v.label === 'string' ? v.label : fallback.label,
    nodeType: typeof v.nodeType === 'string' ? v.nodeType : fallback.nodeType,
    category: typeof v.category === 'string' ? v.category : fallback.category,
    // ``displayCategory`` stays optional. If the data only carries a
    // legacy ``category`` (e.g. test fixtures, run-canvas overlay still
    // routing the legacy bucket), we leave displayCategory undefined and
    // ``category`` is used downstream. New code paths pass both.
    displayCategory:
      typeof v.displayCategory === 'string' ? v.displayCategory : undefined,
    description: typeof v.description === 'string' ? v.description : undefined,
    outputEdges: Array.isArray(v.outputEdges)
      ? (v.outputEdges as unknown[]).filter((x): x is string => typeof x === 'string')
      : fallback.outputEdges,
    outputEdgeLabels,
    overlay: asOverlay(v.overlay),
  };
}

const OVERLAY_STATUS_COLOR: Record<NodeOverlayStatus, string> = {
  pending: 'var(--text-secondary)',
  running: 'var(--color-info)',
  completed: 'var(--color-success)',
  failed: 'var(--color-error)',
  skipped: 'var(--text-secondary)',
};

const OVERLAY_STATUS_LABEL: Record<NodeOverlayStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

const HANDLE_BASE: React.CSSProperties = {
  width: 12,
  height: 6,
  borderRadius: 999,
  border: 0,
};

export function CustomNode({ id, data: rawData, selected }: NodeProps) {
  const data = asCustomData(rawData);
  // Prefer the Phase 11 ``displayCategory`` token; fall back to the
  // legacy ``category`` so saved-state hydration paths that still carry
  // only ``category`` keep rendering.
  const cat = getCategoryDef(data.displayCategory ?? data.category);
  const outputs = data.outputEdges.length > 0 ? data.outputEdges : ['default'];
  const overlay = data.overlay;

  // Run canvas (overlay present) is read-only; only the builder canvas
  // exposes the per-node delete affordance, which routes through a
  // confirm dialog in the builder page (see WorkflowBuilderPage).
  const onDelete = overlay
    ? undefined
    : () => useWorkflowBuilderStore.getState().requestDeleteNode(id);

  const barTrailing = overlay ? (
    <span
      className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        borderColor: OVERLAY_STATUS_COLOR[overlay.status],
        color: OVERLAY_STATUS_COLOR[overlay.status],
      }}
    >
      {OVERLAY_STATUS_LABEL[overlay.status]}
    </span>
  ) : null;

  const footer =
    overlay?.cohortSize !== undefined ? (
      <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
        Cohort:{' '}
        <span className="font-semibold text-[var(--text-primary)]">
          {overlay.cohortSize}
        </span>
      </div>
    ) : null;

  const handles = (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{ ...HANDLE_BASE, background: cat.accentVar, top: -3 }}
      />
      {outputs.map((outputId, idx) => {
        const left = `${((idx + 1) / (outputs.length + 1)) * 100}%`;
        const visibleLabel =
          data.outputEdgeLabels?.[outputId] ?? humanizeOutputId(outputId);
        return (
          <span key={outputId}>
            <Handle
              type="source"
              position={Position.Bottom}
              id={outputId}
              style={{
                ...HANDLE_BASE,
                background: cat.accentVar,
                bottom: -3,
                left,
              }}
            />
            {/* Phase 11 (Commit 2): output-edge labels surface the
                descriptor's display label (or split branch label) right
                under the handle. Renders only when there's more than one
                output — single ``default`` handles stay clean. */}
            {outputs.length > 1 ? (
              <span
                className="pointer-events-none absolute text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]"
                style={{
                  left,
                  bottom: -16,
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                }}
              >
                {visibleLabel}
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );

  return (
    <NodeCard
      variant="canvas"
      label={data.label}
      description={data.description}
      fallbackSubtitle={data.nodeType}
      category={data.displayCategory ?? data.category}
      selected={Boolean(selected)}
      barTrailing={barTrailing}
      footer={footer}
      handles={handles}
      onDelete={onDelete}
    />
  );
}

function humanizeOutputId(id: string): string {
  if (!id) return '';
  // Title-case from snake_case ('on_exhausted_output_id' -> 'On Exhausted ...').
  return id.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
