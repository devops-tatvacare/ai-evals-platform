import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { VisibilityBadge, VisibilityToggle } from '@/components/ui';
import { updateEvalRunVisibility } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores';
import type { AssetVisibility } from '@/types';
import { usePermission } from '@/utils/permissions';

interface EvalRunVisibilityPanelProps {
  runId: string;
  visibility: AssetVisibility;
  ownerId?: string | null;
  onUpdated: (visibility: AssetVisibility) => void;
  mode?: 'panel' | 'inline';
}

export function EvalRunVisibilityPanel({
  runId,
  visibility,
  ownerId,
  onUpdated,
  mode = 'panel',
}: EvalRunVisibilityPanelProps) {
  const [saving, setSaving] = useState(false);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const canShare = usePermission('asset:share');
  const canEdit = useMemo(
    () => canShare && (!ownerId || ownerId === currentUserId),
    [canShare, currentUserId, ownerId],
  );

  const handleChange = async (nextVisibility: AssetVisibility) => {
    if (!canEdit || nextVisibility === visibility) return;
    setSaving(true);
    try {
      const updated = await updateEvalRunVisibility(runId, nextVisibility);
      onUpdated(updated.visibility ?? nextVisibility);
      notificationService.success('Visibility updated');
    } catch (error) {
      notificationService.error(error instanceof Error ? error.message : 'Failed to update visibility');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'inline') {
    return (
      <div className="flex items-center gap-2">
        <VisibilityToggle
          value={visibility}
          onChange={(next) => void handleChange(next)}
          disabled={!canEdit || saving}
          variant="toolbar"
          iconOnly
        />
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">Visibility</span>
            <VisibilityBadge visibility={visibility} compact />
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {canEdit
              ? 'Private runs are only visible to you. Shared runs are visible across your tenant.'
              : canShare
                ? 'Only the run owner can change visibility.'
                : 'You need asset sharing access to change visibility.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <VisibilityToggle value={visibility} onChange={(next) => void handleChange(next)} disabled={!canEdit || saving} />
        </div>
      </div>
    </section>
  );
}
