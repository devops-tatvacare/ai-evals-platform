import { Handle, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { getCategoryDef } from '@/features/orchestration/config/categories';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import { cn } from '@/utils/cn';
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
  /** Phase 14 / Phase E — publish-failure summaries keyed onto this node.
   *  Each entry is `{field, message}` from the structured 400/422 body.
   *  Renders a red alert badge on the canvas card; click focuses the
   *  inspector + centers React Flow on the node. Builder canvas only. */
  publishErrors?: Array<{ field?: string | null; message: string }>;
  /** Phase-14 follow-up — when false, the per-node delete affordance
   *  hides. Defaults to true if not provided to keep older callers
   *  (run-canvas overlay, fixture data) rendering as before. */
  editable?: boolean;
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

function asPublishErrors(
  value: unknown,
): Array<{ field?: string | null; message: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<{ field?: string | null; message: string }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const message = typeof r.message === 'string' ? r.message : null;
    if (!message) continue;
    const field = typeof r.field === 'string' ? r.field : null;
    out.push({ field, message });
  }
  return out.length > 0 ? out : undefined;
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
    publishErrors: asPublishErrors(v.publishErrors),
    editable: typeof v.editable === 'boolean' ? v.editable : true,
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

const OVERLAY_STATUS_ICON: Record<NodeOverlayStatus, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: MinusCircle,
};

const HANDLE_BASE: React.CSSProperties = {
  width: 12,
  height: 6,
  borderRadius: 999,
  border: 0,
};

export function CustomNode({ id, data: rawData, selected }: NodeProps) {
  const data = asCustomData(rawData);
  const reactFlow = useReactFlow();
  // Prefer the Phase 11 ``displayCategory`` token; fall back to the
  // legacy ``category`` so saved-state hydration paths that still carry
  // only ``category`` keep rendering.
  const cat = getCategoryDef(data.displayCategory ?? data.category);
  const outputs = data.outputEdges.length > 0 ? data.outputEdges : ['default'];
  const overlay = data.overlay;
  const publishErrors = data.publishErrors;

  // Run canvas (overlay present) is read-only; only the builder canvas
  // exposes the per-node delete affordance, which routes through a
  // confirm dialog in the builder page (see WorkflowBuilderPage). The
  // `editable` flag (Phase-14 follow-up) further hides the delete in
  // view mode even when no run overlay is present.
  const onDelete =
    overlay || !data.editable
      ? undefined
      : () => useWorkflowBuilderStore.getState().requestDeleteNode(id);

  // Phase 14 / Phase E — clicking the publish-error badge centers the
  // node and selects it so the inspector opens to the right form. The
  // builder canvas suppresses the badge during a live run (overlay set).
  const onClickErrorBadge = (e: React.MouseEvent) => {
    e.stopPropagation();
    const node = reactFlow.getNode(id);
    if (node) {
      const x = node.position.x + (node.measured?.width ?? node.width ?? 240) / 2;
      const y = node.position.y + (node.measured?.height ?? node.height ?? 80) / 2;
      reactFlow.setCenter(x, y, { zoom: reactFlow.getZoom(), duration: 300 });
    }
    useWorkflowBuilderStore.getState().setSelectedNode(id);
  };

  const errorBadge =
    !overlay && publishErrors && publishErrors.length > 0 ? (
      <button
        type="button"
        onClick={onClickErrorBadge}
        aria-label={`Publish error on ${data.label || data.nodeType}`}
        title={publishErrors
          .map((p) => (p.field ? `${p.field}: ${p.message}` : p.message))
          .join('\n')}
        data-testid="custom-node-publish-error-badge"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-error)] hover:bg-[var(--surface-error-subtle,var(--bg-tertiary))]"
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    ) : null;

  const barTrailing = overlay
    ? (() => {
        const StatusIcon = OVERLAY_STATUS_ICON[overlay.status];
        return (
          <span
            className="inline-flex h-4 w-4 items-center justify-center"
            style={{ color: OVERLAY_STATUS_COLOR[overlay.status] }}
            title={OVERLAY_STATUS_LABEL[overlay.status]}
            aria-label={OVERLAY_STATUS_LABEL[overlay.status]}
          >
            <StatusIcon
              className={cn(
                'h-3.5 w-3.5',
                overlay.status === 'running' && 'animate-spin',
              )}
            />
          </span>
        );
      })()
    : errorBadge;

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
