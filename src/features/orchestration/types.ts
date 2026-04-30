export type WorkflowType = 'crm' | 'clinical';
export type NodeCategory = 'source' | 'filter' | 'logic' | 'action' | 'escalation' | 'sink';
export type RunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type TriggerKind = 'cron' | 'event' | 'manual';
export type WorkflowVersionStatus = 'draft' | 'published' | 'archived';
export type OverrideAction = 'pause' | 'resume' | 'jump_to_node' | 'remove' | 'complete';

export interface NodeTypeDescriptor {
  nodeType: string;
  workflowType: string;
  category: NodeCategory;
  label: string;
  description: string;
  outputEdges: string[];
  configSchema: Record<string, unknown>;
}

export interface WorkflowDefinitionNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; nodeType: string };
  config: Record<string, unknown>;
}

export interface WorkflowDefinitionEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowDefinitionNode[];
  edges: WorkflowDefinitionEdge[];
  canvas?: { viewport?: { x: number; y: number; zoom: number } };
}

export interface Workflow {
  id: string;
  tenantId: string;
  appId: string;
  workflowType: WorkflowType;
  slug: string;
  name: string;
  description: string | null;
  currentPublishedVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  definition: WorkflowDefinition;
  status: WorkflowVersionStatus;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface WorkflowTrigger {
  id: string;
  workflowId: string;
  kind: TriggerKind;
  cronExpression: string | null;
  eventName: string | null;
  scheduledJobId: string | null;
  params: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  triggeredBy: TriggerKind;
  triggeredByUserId: string | null;
  status: RunStatus;
  cohortSizeAtEntry: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  params: Record<string, unknown>;
  createdAt: string;
}

export interface RecipientState {
  recipientId: string;
  currentNodeId: string | null;
  status: string;
  wakeupAt: string | null;
  payload: Record<string, unknown>;
  enrolledAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface ActionRow {
  id: string;
  recipientId: string;
  channel: string;
  actionType: string;
  status: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  error: string | null;
  parentActionId: string | null;
  createdAt: string;
  completedAt: string | null;
}
