import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { ApiError } from '@/services/api/client';
import {
  createDraftVersion,
  fireManualRun,
  publishVersion,
} from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';

function describeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return fallback;
}

export function WorkflowHeaderBar() {
  const workflowId = useWorkflowBuilderStore((s) => s.workflowId);
  const versionId = useWorkflowBuilderStore((s) => s.versionId);
  const name = useWorkflowBuilderStore((s) => s.workflowName);
  const dirty = useWorkflowBuilderStore((s) => s.dirty);
  const workflowType = useWorkflowBuilderStore((s) => s.workflowType);

  const [busy, setBusy] = useState(false);

  const saveDraft = async (): Promise<string | null> => {
    if (!workflowId || !workflowType) return null;
    const store = useWorkflowBuilderStore.getState();
    const v = await createDraftVersion(workflowId, store.toDefinition());
    store.setMetadata({ workflowId, versionId: v.id, name, workflowType });
    store.hydrate(v.definition);
    return v.id;
  };

  const handleSave = async () => {
    if (!workflowId || !workflowType) return;
    setBusy(true);
    try {
      await saveDraft();
      notificationService.success('Draft saved');
    } catch (e) {
      notificationService.error(describeError(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!workflowId) return;
    setBusy(true);
    try {
      let target = versionId;
      if (!target || dirty) {
        target = await saveDraft();
      }
      if (!target) {
        notificationService.error('No draft version to publish');
        return;
      }
      await publishVersion(workflowId, target);
      notificationService.success('Published');
    } catch (e) {
      notificationService.error(describeError(e, 'Publish failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async () => {
    if (!workflowId) return;
    setBusy(true);
    try {
      const run = await fireManualRun(workflowId);
      notificationService.success(`Run started: ${run.id.slice(0, 8)}`);
    } catch (e) {
      notificationService.error(describeError(e, 'Run failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-2">
      <div className="font-medium text-[var(--text-primary)]">
        {name || 'Untitled Workflow'}
        {dirty && (
          <span className="ml-2 text-xs text-[var(--color-warning)]">(unsaved)</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={handleSave} disabled={busy || !dirty}>
          Save Draft
        </Button>
        <Button variant="primary" onClick={handlePublish} disabled={busy}>
          Publish
        </Button>
        <Button variant="secondary" onClick={handleRun} disabled={busy}>
          Run Now
        </Button>
      </div>
    </div>
  );
}
