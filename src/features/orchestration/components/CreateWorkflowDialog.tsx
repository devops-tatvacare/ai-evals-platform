import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { Select } from '@/components/ui/Select';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { useCurrentAppId } from '@/hooks';
import { ApiError } from '@/services/api/client';
import { createWorkflow } from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import { WORKFLOW_TYPE_OPTIONS, type Workflow, type WorkflowType } from '@/features/orchestration/types';
import type { AssetVisibility } from '@/types/settings.types';

interface Props {
  isOpen: boolean;
  onClose(): void;
  onCreated(wf: Workflow): void;
}

export function CreateWorkflowDialog({ isOpen, onClose, onCreated }: Props) {
  const appId = useCurrentAppId();
  const titleId = useId();
  const [workflowType, setWorkflowType] = useState<WorkflowType>('crm');
  const [visibility, setVisibility] = useState<AssetVisibility>('private');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Parent always renders this component so RightSlideOverShell can drive the
  // exit animation; reset the form when the slide-over closes so a re-open
  // starts blank instead of replaying the previous attempt's values.
  useEffect(() => {
    if (isOpen) return;
    setWorkflowType('crm');
    setVisibility('private');
    setSlug('');
    setName('');
  }, [isOpen]);

  const submit = async () => {
    setBusy(true);
    try {
      const wf = await createWorkflow({
        appId,
        workflowType,
        slug: slug.trim(),
        name: name.trim(),
        visibility,
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

  const canSubmit = !busy && slug.trim().length > 0 && name.trim().length > 0;

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          New Workflow
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
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Workflow Type
            </label>
            <Select
              value={workflowType}
              onChange={(v) => setWorkflowType(v as WorkflowType)}
              options={WORKFLOW_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Slug (stable id)
            </label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. mql-concierge"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Display Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Human-readable name"
            />
          </div>

          <div>
            <span className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Visibility
            </span>
            <div className="flex flex-col items-start gap-1">
              <VisibilityToggle value={visibility} onChange={setVisibility} variant="toolbar" />
              <span className="text-[12px] text-[var(--text-muted)]">
                Private is the default. Share only when teammates should see this campaign.
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!canSubmit} isLoading={busy}>
            Create
          </Button>
        </div>
      </form>
    </RightSlideOverShell>
  );
}
