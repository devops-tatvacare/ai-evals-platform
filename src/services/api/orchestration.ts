import { apiRequest } from './client';
import type {
  ActionRow,
  CohortSource,
  NodeTypeDescriptor,
  RecipientState,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowTrigger,
  WorkflowType,
  WorkflowVersion,
} from '@/features/orchestration/types';

export async function listWorkflows(params?: {
  appId?: string;
  workflowType?: WorkflowType;
}): Promise<Workflow[]> {
  const q = new URLSearchParams();
  if (params?.appId) q.set('appId', params.appId);
  if (params?.workflowType) q.set('workflowType', params.workflowType);
  const qs = q.toString();
  return apiRequest<Workflow[]>(`/api/orchestration/workflows${qs ? `?${qs}` : ''}`);
}

export async function listSystemWorkflows(params?: {
  appId?: string;
  workflowType?: WorkflowType;
}): Promise<Workflow[]> {
  const q = new URLSearchParams();
  if (params?.appId) q.set('appId', params.appId);
  if (params?.workflowType) q.set('workflowType', params.workflowType);
  const qs = q.toString();
  return apiRequest<Workflow[]>(`/api/orchestration/system-workflows${qs ? `?${qs}` : ''}`);
}

export async function createWorkflow(body: {
  appId: string;
  workflowType: WorkflowType;
  slug: string;
  name: string;
  description?: string;
}): Promise<Workflow> {
  return apiRequest<Workflow>('/api/orchestration/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return apiRequest<Workflow>(`/api/orchestration/workflows/${id}`);
}

export async function updateWorkflow(
  id: string,
  body: { name?: string; description?: string },
): Promise<Workflow> {
  return apiRequest<Workflow>(`/api/orchestration/workflows/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function archiveWorkflow(id: string): Promise<void> {
  await apiRequest<void>(`/api/orchestration/workflows/${id}`, { method: 'DELETE' });
}

export async function cloneSystemWorkflow(body: {
  sourceWorkflowId: string;
  newSlug: string;
  newName: string;
  targetAppId: string;
}): Promise<Workflow> {
  return apiRequest<Workflow>('/api/orchestration/workflows/clone', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listVersions(workflowId: string): Promise<WorkflowVersion[]> {
  return apiRequest<WorkflowVersion[]>(`/api/orchestration/workflows/${workflowId}/versions`);
}

export async function createDraftVersion(
  workflowId: string,
  definition: WorkflowDefinition,
): Promise<WorkflowVersion> {
  return apiRequest<WorkflowVersion>(`/api/orchestration/workflows/${workflowId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ definition }),
  });
}

export async function publishVersion(
  workflowId: string,
  versionId: string,
): Promise<WorkflowVersion> {
  return apiRequest<WorkflowVersion>(
    `/api/orchestration/workflows/${workflowId}/versions/${versionId}/publish`,
    { method: 'POST' },
  );
}

export async function listTriggers(workflowId: string): Promise<WorkflowTrigger[]> {
  return apiRequest<WorkflowTrigger[]>(`/api/orchestration/workflows/${workflowId}/triggers`);
}

export async function createTrigger(
  workflowId: string,
  body: {
    kind: 'cron' | 'event' | 'manual';
    cronExpression?: string;
    eventName?: string;
    params?: Record<string, unknown>;
    active?: boolean;
  },
): Promise<WorkflowTrigger> {
  return apiRequest<WorkflowTrigger>(`/api/orchestration/workflows/${workflowId}/triggers`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteTrigger(triggerId: string): Promise<void> {
  await apiRequest<void>(`/api/orchestration/triggers/${triggerId}`, { method: 'DELETE' });
}

export async function fireManualRun(
  workflowId: string,
  params: Record<string, unknown> = {},
): Promise<WorkflowRun> {
  return apiRequest<WorkflowRun>('/api/orchestration/runs', {
    method: 'POST',
    body: JSON.stringify({ workflowId, params }),
  });
}

export async function listRuns(params?: {
  workflowId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<WorkflowRun[]> {
  const q = new URLSearchParams();
  if (params?.workflowId) q.set('workflowId', params.workflowId);
  if (params?.status) q.set('status', params.status);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest<WorkflowRun[]>(`/api/orchestration/runs${qs ? `?${qs}` : ''}`);
}

export async function getRun(id: string): Promise<WorkflowRun> {
  return apiRequest<WorkflowRun>(`/api/orchestration/runs/${id}`);
}

export async function listRunRecipients(
  runId: string,
  params?: { limit?: number; offset?: number },
): Promise<RecipientState[]> {
  const q = new URLSearchParams();
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest<RecipientState[]>(
    `/api/orchestration/runs/${runId}/recipients${qs ? `?${qs}` : ''}`,
  );
}

export async function listRunActions(
  runId: string,
  params?: { channel?: string; actionType?: string; limit?: number; offset?: number },
): Promise<ActionRow[]> {
  const q = new URLSearchParams();
  if (params?.channel) q.set('channel', params.channel);
  if (params?.actionType) q.set('actionType', params.actionType);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  return apiRequest<ActionRow[]>(
    `/api/orchestration/runs/${runId}/actions${qs ? `?${qs}` : ''}`,
  );
}

export async function applyOverride(
  runId: string,
  recipientId: string,
  body: {
    action: 'pause' | 'resume' | 'jump_to_node' | 'remove' | 'complete';
    targetNodeId?: string;
    reason?: string;
  },
): Promise<unknown> {
  return apiRequest<unknown>(
    `/api/orchestration/runs/${runId}/recipients/${recipientId}/override`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function fetchNodeTypes(
  workflowType?: WorkflowType,
): Promise<NodeTypeDescriptor[]> {
  const q = workflowType ? `?workflowType=${workflowType}` : '';
  return apiRequest<NodeTypeDescriptor[]>(`/api/orchestration/node_types${q}`);
}

export async function fetchCohortSources(params?: {
  workflowType?: WorkflowType;
  appId?: string;
}): Promise<CohortSource[]> {
  const search = new URLSearchParams();
  if (params?.workflowType) search.set('workflowType', params.workflowType);
  if (params?.appId) search.set('appId', params.appId);
  const qs = search.toString();
  return apiRequest<CohortSource[]>(
    `/api/orchestration/source_catalog${qs ? `?${qs}` : ''}`,
  );
}
