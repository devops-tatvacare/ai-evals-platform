import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { Avatar } from '@/components/ui/Avatar';
import type { ActiveDraftInfo } from '@/types/reviews';

interface ReviewLockTooltipProps {
  activeDraft: ActiveDraftInfo;
  children: ReactNode;
}

function formatElapsed(startedAt: string): string {
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return 'just now';
  const diffMs = Date.now() - startMs;
  const mins = Math.max(0, Math.round(diffMs / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/**
 * Wraps any Start-Review trigger; when another reviewer holds the draft, shows
 * a rich tooltip with the owner's name + elapsed time. Pass-through otherwise.
 */
export function ReviewLockTooltip({ activeDraft, children }: ReviewLockTooltipProps) {
  const name = activeDraft.reviewerName?.trim() || 'Another reviewer';
  const content = (
    <div className="flex flex-col gap-1 min-w-[220px]">
      <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
        <Avatar name={name} size="xs" />
        Review in progress
      </div>
      <div className="text-[var(--text-secondary)] text-[12px]">
        <strong className="text-[var(--text-primary)]">{name}</strong> · started {formatElapsed(activeDraft.startedAt)}
      </div>
      <div className="text-[var(--text-muted)] text-[11px] pt-1 border-t border-[var(--border-subtle)]">
        Only one reviewer can edit a run at a time.
      </div>
    </div>
  );

  return (
    <Tooltip content={content} position="bottom" maxWidth={280}>
      {children}
    </Tooltip>
  );
}

export { Lock as ReviewLockIcon };
