import { useMemo } from 'react';

import { useRunActions } from '@/features/orchestration/queries/runs';
import { ActionDetailPanel } from '@/features/orchestration/components/ActionDetailPanel';

interface Props {
  runId: string;
  actionId: string;
  onClose(): void;
}

/**
 * Secondary right-overlay that opens over the primary `RunInspectorOverlay`.
 * Looks up the action by id from the cached actions page, then hands it to
 * the existing `ActionDetailPanel` which owns the rendered detail
 * (channel-specific bodies, raw JSON sections, etc.).
 *
 * Stacking: both overlays share the chassis's default `--z-overlay` layer,
 * but the secondary mounts later in the DOM (this component renders inside
 * the primary), so it naturally paints on top within the same layer.
 * `useRightOverlay`'s global `escapeStack` ensures Escape closes the
 * top-most overlay first, then the parent — the chassis handles
 * focus restoration on close.
 *
 * Why we don't refetch by id: the backend has no GET-by-id endpoint for
 * actions today (`listRunActions` is the only read path). When that
 * endpoint ships, we can swap this lookup for a real query without
 * touching the URL contract.
 */
export function ActionDetailOverlay({ runId, actionId, onClose }: Props) {
  // Read straight from the same TQ cache the parent's actions panel
  // populated; selection clicks always come from rows already on screen,
  // so the cache is warm by construction. If a deep link arrives before
  // the actions list has loaded, the panel renders an empty body (the
  // existing `ActionDetailPanel` already handles `action: null`).
  const actionsQuery = useRunActions(runId, { pageSize: 200 });
  const action = useMemo(
    () => actionsQuery.data?.find((a) => a.id === actionId) ?? null,
    [actionsQuery.data, actionId],
  );

  return (
    <ActionDetailPanel action={action} open={true} onClose={onClose} />
  );
}
