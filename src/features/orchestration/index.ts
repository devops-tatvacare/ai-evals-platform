// Public surface of the orchestration feature module. Components consumed
// outside the feature (Router lazy-loads, route helpers) import from here so
// the feature's internal layout can change without touching every consumer.

export { WorkflowBuilderPage } from './components/WorkflowBuilderPage';
export { CampaignsPage } from './components/campaigns/CampaignsPage';
export { useWorkflowBuilderStore } from './store/workflowBuilderStore';

export type {
  ActionRow,
  NodeCategory,
  NodeTypeDescriptor,
  OverrideAction,
  RecipientState,
  RunStatus,
  TriggerKind,
  Workflow,
  WorkflowDefinition,
  WorkflowDefinitionEdge,
  WorkflowDefinitionNode,
  WorkflowRun,
  WorkflowTrigger,
  WorkflowType,
  WorkflowVersion,
  WorkflowVersionStatus,
} from './types';
