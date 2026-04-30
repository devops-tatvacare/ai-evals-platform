import { useEffect } from 'react';
import { useParams } from 'react-router-dom';

import { LoadingState } from '@/components/ui/LoadingState';
import { ApiError } from '@/services/api/client';
import { getWorkflow, listVersions } from '@/services/api/orchestration';
import { notificationService } from '@/services/notifications';
import { useWorkflowBuilderStore } from '@/features/orchestration/store/workflowBuilderStore';
import { Canvas } from './Canvas';
import { NodeConfigPanel } from './NodeConfigPanel';
import { Palette } from './Palette';
import { WorkflowHeaderBar } from './WorkflowHeaderBar';

export function WorkflowBuilderPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const reset = useWorkflowBuilderStore((s) => s.reset);
  const setMetadata = useWorkflowBuilderStore((s) => s.setMetadata);
  const hydrate = useWorkflowBuilderStore((s) => s.hydrate);

  useEffect(() => {
    if (!workflowId) return;
    let alive = true;
    (async () => {
      reset();
      try {
        const wf = await getWorkflow(workflowId);
        const versions = await listVersions(workflowId);
        const draft = versions.find((v) => v.status === 'draft');
        const targetVersion = draft ?? versions[0] ?? null;
        if (!alive) return;
        setMetadata({
          workflowId: wf.id,
          versionId: targetVersion?.id ?? null,
          name: wf.name,
          workflowType: wf.workflowType,
        });
        if (targetVersion) {
          hydrate(targetVersion.definition);
        }
      } catch (e) {
        if (!alive) return;
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Failed to load workflow';
        notificationService.error(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workflowId, reset, setMetadata, hydrate]);

  if (!workflowId) return <LoadingState />;

  return (
    <div className="flex h-full flex-col">
      <WorkflowHeaderBar />
      <div className="flex flex-1 overflow-hidden">
        <Palette />
        <div className="flex-1">
          <Canvas />
        </div>
        <NodeConfigPanel />
      </div>
    </div>
  );
}
