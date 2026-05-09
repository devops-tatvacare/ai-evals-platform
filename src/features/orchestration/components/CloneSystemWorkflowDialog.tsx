import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import type { Workflow } from '@/features/orchestration/types';
import { cloneSystemWorkflow } from '@/services/api/orchestration';
import { ApiError } from '@/services/api/client';
import { notificationService } from '@/services/notifications';

interface CloneSystemWorkflowDialogProps {
  /** Pass null to close the slide-over; the last non-null value is captured so
   *  the panel body keeps rendering correctly during the exit animation. */
  sourceWorkflow: Workflow | null;
  onClose(): void;
  onCloned(workflow: Workflow): void;
}

export function CloneSystemWorkflowDialog({
  sourceWorkflow,
  onClose,
  onCloned,
}: CloneSystemWorkflowDialogProps) {
  const titleId = useId();
  const isOpen = sourceWorkflow !== null;

  // Snapshot the last non-null source so the body keeps the right name + slug
  // during the close animation after the parent flips sourceWorkflow to null.
  const [snapshot, setSnapshot] = useState<Workflow | null>(null);
  const display = sourceWorkflow ?? snapshot;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed the inputs from the incoming source whenever a clone is opened.
  useEffect(() => {
    if (!sourceWorkflow) return;
    setSnapshot(sourceWorkflow);
    setName(sourceWorkflow.name);
    setSlug(`${sourceWorkflow.slug}-copy`);
  }, [sourceWorkflow]);

  const submit = async () => {
    if (!display) return;
    setBusy(true);
    try {
      const workflow = await cloneSystemWorkflow({
        sourceWorkflowId: display.id,
        newSlug: slug.trim(),
        newName: name.trim(),
        targetAppId: display.appId,
      });
      onCloned(workflow);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to clone workflow';
      notificationService.error(message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && name.trim().length > 0 && slug.trim().length > 0;

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          Clone System Workflow
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {display ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Create a tenant-owned copy of{' '}
              <span className="font-medium text-[var(--text-primary)]">{display.name}</span>.
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Display Name
            </label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Slug (stable id)
            </label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!canSubmit} isLoading={busy}>
            Clone
          </Button>
        </div>
      </form>
    </RightSlideOverShell>
  );
}
