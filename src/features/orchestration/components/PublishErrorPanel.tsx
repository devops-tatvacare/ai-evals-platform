import { AlertCircle, X } from 'lucide-react';

import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import type { ApiErrorBody, FieldErrorItem } from '@/features/orchestration/contracts/errorDecoder';

interface Props {
  body: ApiErrorBody | null;
  /** Optional dismiss handler. When provided, the panel renders an X. */
  onDismiss?: () => void;
}

/** Phase 14 / Phase A — surfaces structured publish errors so a missing
 *  field on a Bolna or WATI node renders as
 *  `{ node label / type } · { field }: { message }` instead of
 *  `[object Object],[object Object]`.
 *
 *  The panel is intentionally minimal: a vertical list of items grouped by
 *  node. Phase E layers click-to-focus + canvas decorations on top. */
export function PublishErrorPanel({ body, onDismiss }: Props) {
  if (!body) return null;
  if (body.kind === 'message') {
    return (
      <ErrorShell onDismiss={onDismiss}>
        <p className="text-sm text-[var(--color-error)]">{body.message}</p>
      </ErrorShell>
    );
  }
  if (body.kind === 'fieldErrors') {
    return (
      <ErrorShell onDismiss={onDismiss}>
        <ul className="flex flex-col gap-1.5">
          {body.items.map((item, idx) => (
            <FieldErrorRow key={`${item.nodeId ?? 'global'}:${idx}`} item={item} />
          ))}
        </ul>
      </ErrorShell>
    );
  }
  // kind === 'unknown' — render a generic fallback.
  return (
    <ErrorShell onDismiss={onDismiss}>
      <p className="text-sm text-[var(--color-error)]">
        Publish failed. Server returned an unrecognised error shape.
      </p>
    </ErrorShell>
  );
}

function FieldErrorRow({ item }: { item: FieldErrorItem }) {
  const node = useWorkflowBuilderStore((s) =>
    item.nodeId ? s.nodes.find((n) => n.id === item.nodeId) ?? null : null,
  );
  const palette = useWorkflowBuilderStore((s) => s.paletteCatalog);
  const desc = node ? palette.find((p) => p.nodeType === node.type) ?? null : null;
  const nodeLabel = node
    ? (desc?.displayLabel ?? desc?.label ?? node.type)
    : null;
  const nodeType = node?.type ?? null;

  const prefixParts: string[] = [];
  if (nodeLabel) {
    prefixParts.push(nodeType && nodeType !== nodeLabel ? `${nodeLabel} (${nodeType})` : nodeLabel);
  } else if (item.nodeId) {
    // Node was referenced but no longer in the canvas — show the raw id.
    prefixParts.push(item.nodeId);
  }
  if (item.field) prefixParts.push(item.field);
  const prefix = prefixParts.join(' · ');

  return (
    <li className="flex items-start gap-2 text-sm">
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-error)]"
      />
      <span className="text-[var(--text-primary)]">
        {prefix ? (
          <>
            <span className="font-medium">{prefix}</span>
            <span className="text-[var(--text-secondary)]">: </span>
          </>
        ) : null}
        <span>{item.message}</span>
      </span>
    </li>
  );
}

function ErrorShell({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-[var(--color-error)] bg-[var(--surface-error-subtle,var(--bg-tertiary))] px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-error)]">
          Publish failed
        </div>
        {children}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
