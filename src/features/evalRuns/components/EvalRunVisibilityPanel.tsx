import { useMemo, useState } from 'react';
import { Globe2, Lock } from 'lucide-react';
import { Switch, VisibilityBadge } from '@/components/ui';
import { updateEvalRunVisibility } from '@/services/api/evalRunsApi';
import { notificationService } from '@/services/notifications';
import { useAuthStore } from '@/stores';
import type { AssetVisibility } from '@/types';
import { usePermission } from '@/utils/permissions';
import { ActionIconButton } from './RunHeaderActions';

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
  const isShared = visibility === 'shared';
  const tooltipContent = !canEdit
    ? canShare
      ? 'Only the run owner can change visibility.'
      : 'You need asset sharing access to change visibility.'
    : isShared
      ? 'Shared runs are visible across your tenant.'
      : 'Private runs are only visible to you.';

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
      <ActionIconButton
        icon={isShared ? Globe2 : Lock}
        label={isShared ? 'Shared — click to make private' : 'Private — click to share'}
        tooltip={tooltipContent}
        onClick={() => void handleChange(isShared ? 'private' : 'shared')}
        disabled={!canEdit || saving}
        spinning={saving}
      />
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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Lock className="h-3.5 w-3.5" />
            <span>Private</span>
          </div>
          <Switch
            checked={isShared}
            onCheckedChange={(checked) => void handleChange(checked ? 'shared' : 'private')}
            disabled={!canEdit || saving}
            aria-label={isShared ? 'Shared visibility' : 'Private visibility'}
          />
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Globe2 className="h-3.5 w-3.5" />
            <span>Shared</span>
          </div>
        </div>
      </div>
    </section>
  );
}
