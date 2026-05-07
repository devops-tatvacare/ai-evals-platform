import { useEffect, useRef, useState } from 'react';

import { applyOverride } from '@/services/api/orchestration';
import type { OverrideAction } from '@/features/orchestration/types';
import { notificationService } from '@/services/notifications/notificationService';
import { cn } from '@/utils';

interface OverrideMenuProps {
  runId: string;
  recipientId: string;
  onApplied(): void;
}

const ACTIONS: { action: OverrideAction; label: string }[] = [
  { action: 'pause', label: 'Pause' },
  { action: 'resume', label: 'Resume' },
  { action: 'remove', label: 'Remove from Run' },
  { action: 'complete', label: 'Mark Complete' },
];

/** Per-recipient override kebab. Calls the Phase 5 override route then asks
 *  the parent to refresh the recipients table. */
export function OverrideMenu({ runId, recipientId, onApplied }: OverrideMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const apply = async (action: OverrideAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await applyOverride(runId, recipientId, { action, reason: `manual ${action}` });
      notificationService.success(`${action} applied`);
      onApplied();
    } catch (err) {
      const message = err instanceof Error ? err.message : `${action} failed`;
      notificationService.error(message);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
        onClick={() => setOpen((v) => !v)}
        aria-label="Override actions"
        disabled={busy}
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 flex min-w-[10rem] flex-col rounded-md border bg-[var(--bg-elevated)] p-1 shadow-md"
          style={{ borderColor: 'var(--border-default)', zIndex: 'var(--z-dropdown)' }}
        >
          {ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              type="button"
              className={cn(
                'rounded px-2 py-1 text-left text-sm text-[var(--text-primary)]',
                'hover:bg-[var(--bg-secondary)]',
              )}
              onClick={() => apply(action)}
              disabled={busy}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
