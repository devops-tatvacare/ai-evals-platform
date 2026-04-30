import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/services/api/client';
import { createWorkflow } from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import type { Workflow, WorkflowType } from '@/features/orchestration/types';

const WORKFLOW_TYPE_OPTIONS = [
  { value: 'crm', label: 'CRM' },
  { value: 'clinical', label: 'Clinical' },
] as const;

interface Props {
  onClose(): void;
  onCreated(wf: Workflow): void;
}

export function CreateWorkflowDialog({ onClose, onCreated }: Props) {
  const [workflowType, setWorkflowType] = useState<WorkflowType>('crm');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const wf = await createWorkflow({
        appId: 'inside-sales',
        workflowType,
        slug: slug.trim(),
        name: name.trim(),
      });
      onCreated(wf);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Failed to create workflow';
      notificationService.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New Campaign">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          Workflow Type
          <Select
            value={workflowType}
            onChange={(v) => setWorkflowType(v as WorkflowType)}
            options={WORKFLOW_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          Slug (stable id)
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
          Display Name
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !slug.trim() || !name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
