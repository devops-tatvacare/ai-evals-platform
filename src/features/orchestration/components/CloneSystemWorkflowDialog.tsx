import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { Workflow } from '@/features/orchestration/types';
import { cloneSystemWorkflow } from '@/services/api/orchestration';
import { ApiError } from '@/services/api/client';
import { notificationService } from '@/services/notifications';

interface CloneSystemWorkflowDialogProps {
  sourceWorkflow: Workflow;
  onClose(): void;
  onCloned(workflow: Workflow): void;
}

export function CloneSystemWorkflowDialog({
  sourceWorkflow,
  onClose,
  onCloned,
}: CloneSystemWorkflowDialogProps) {
  const [name, setName] = useState(sourceWorkflow.name);
  const [slug, setSlug] = useState(`${sourceWorkflow.slug}-copy`);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const workflow = await cloneSystemWorkflow({
        sourceWorkflowId: sourceWorkflow.id,
        newSlug: slug.trim(),
        newName: name.trim(),
        targetAppId: sourceWorkflow.appId,
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

  return (
    <Modal isOpen onClose={onClose} title="Clone System Workflow">
      <div className="flex flex-col gap-3">
        <div className="text-sm text-[var(--text-secondary)]">
          Create a tenant-owned copy of <span className="font-medium text-[var(--text-primary)]">{sourceWorkflow.name}</span>.
        </div>
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          Display Name
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          Slug (stable id)
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || !slug.trim()}>
            Clone
          </Button>
        </div>
      </div>
    </Modal>
  );
}
