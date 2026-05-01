export type WorkflowType = 'crm' | 'clinical';

// Phase 11 — neutral, functional palette categories.
export type DisplayCategory =
  | 'ingress'
  | 'qualification'
  | 'routing'
  | 'suspension'
  | 'synchronization'
  | 'dispatch'
  | 'mutation'
  | 'termination';

export type AuthoringStatus = 'active' | 'hidden' | 'experimental' | 'deprecated';

export type ExecutionKind =
  | 'entry_sql'
  | 'entry_event'
  | 'qualification'
  | 'routing'
  | 'suspension'
  | 'synchronization'
  | 'dispatch'
  | 'mutation'
  | 'termination';

// Legacy bucket — preserved on `NodeTypeDescriptor.category` so older builder
// code (palette grouping, badge colors) keeps rendering until it migrates to
// `displayCategory`.
export type NodeCategory = 'source' | 'filter' | 'logic' | 'action' | 'escalation' | 'sink';

export type RunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type TriggerKind = 'cron' | 'event' | 'manual';
export type WorkflowVersionStatus = 'draft' | 'published' | 'archived';
export type OverrideAction = 'pause' | 'resume' | 'jump_to_node' | 'remove' | 'complete';

export interface NodeOutputEdge {
  id: string;
  label: string;
  cardinality: 'one' | 'many';
  dynamic: boolean;
}

export interface NodeGraphRules {
  requiresIncomingEdges?: boolean;
  requiresOutgoingEdges?: boolean;
  requiredOutputIds?: string[];
  allowsMultipleOutgoingPerOutput?: boolean;
  terminal?: boolean;
}

export interface NodeRuntimeContract {
  executionKind: ExecutionKind;
  supportsAttemptPolicy?: boolean;
  supportsSuspendResume?: boolean;
}

export interface NodeEditorHints {
  preferredEditor?: string;
  hiddenFields?: string[];
  readOnlyFields?: string[];
  fieldOrder?: string[];
  emptyStateMessage?: string;
}

export interface NodeTypeDescriptor {
  nodeType: string;
  workflowType: string;

  // Phase 11 canonical fields.
  displayLabel: string;
  displayCategory: DisplayCategory;
  description: string;
  authoringStatus: AuthoringStatus;

  configSchema: Record<string, unknown>;
  editorHints: NodeEditorHints;

  requiredPayloadFields: string[];
  emittedPayloadFields: string[];

  outputEdges: NodeOutputEdge[];

  graphRules: NodeGraphRules;
  runtimeContract: NodeRuntimeContract;

  // Back-compat fields — populated by the backend so legacy builder code keeps working.
  category: NodeCategory;
  label: string;
}

export interface WorkflowDefinitionNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label?: string; nodeType?: string };
  config: Record<string, unknown>;
}

export interface WorkflowDefinitionEdge {
  id: string;
  source: string;
  target: string;
  /**
   * Phase 11 routing key — the stable machine id of the source node's output edge.
   * Always populated on canonical (post-normalization) definitions.
   */
  outputId?: string;
  /**
   * Legacy field — superseded by `outputId`. Still accepted on read for back-compat
   * with pre-Phase-11 saved definitions; the backend's normalization layer rewrites
   * it to `outputId` at publish time.
   */
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

/**
 * Returns the routing key for an edge, accepting the canonical `outputId`
 * field, the legacy `label` field, or falling back to `'default'`.
 *
 * Use this whenever code needs to match an outgoing edge to a node's
 * declared output. The backend normalizer produces canonical edges with
 * `outputId` set, but unsynchronized FE state and old saved definitions
 * may still carry only `label`.
 */
export function getEdgeOutputId(edge: WorkflowDefinitionEdge): string {
  return edge.outputId ?? edge.label ?? 'default';
}

// ─── Phase 11 (Commit 2) — specialized editor contracts ─────────────────────

export interface CohortSource {
  sourceRef: string;
  displayLabel: string;
  description: string;
  workflowTypes: string[];
  appIds: string[];
  idColumn: string;
  allowedPayloadColumns: string[];
  allowedFilterColumns: string[];
  allowedLookbackColumns: string[];
}

/** Backoff strategy for retry-capable dispatch nodes. ``immediate`` means
 *  the next attempt runs on the same task tick. ``fixed_delay`` /
 *  ``exponential`` declare the contract; the suspend-and-resume backoff
 *  implementation is a follow-up to Phase 11 (see backend
 *  ``attempt_policy.py`` module docstring). */
export type AttemptBackoffKind = 'immediate' | 'fixed_delay' | 'exponential';

export interface AttemptPolicy {
  max_attempts: number;
  backoff_kind: AttemptBackoffKind;
  delay_minutes: number;
  retry_on: string[];
  on_exhausted_output_id: string;
}

export const DEFAULT_ATTEMPT_POLICY: AttemptPolicy = {
  max_attempts: 1,
  backoff_kind: 'immediate',
  delay_minutes: 0,
  retry_on: [],
  on_exhausted_output_id: 'exhausted',
};

/** A predicate AST node — typed mirror of
 *  ``backend/app/services/orchestration/predicate_contract.py``. */
export type PredicateOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'is_not_null';

export interface LeafPredicate {
  field: string;
  op: PredicateOp;
  value?: unknown;
}

export interface AndPredicate {
  all: PredicateAst[];
}

export interface OrPredicate {
  any: PredicateAst[];
}

export interface NotPredicate {
  not: PredicateAst;
}

export type PredicateAst =
  | LeafPredicate
  | AndPredicate
  | OrPredicate
  | NotPredicate;

export type WaitMode =
  | 'duration'
  | 'until_datetime'
  | 'event'
  | 'event_or_timeout';

export type SplitMode = 'by_field' | 'by_rules' | 'random';

export interface SplitBranch {
  id: string;
  label: string;
  /** Discriminator-specific extras (match value / predicate / weight)
   *  carried as a free-form dict — the editor surfaces the right shape. */
  match?: unknown;
  predicate?: PredicateAst;
  weight?: number;
}

export type MergePolicy = 'dedupe' | 'last_wins' | 'merge_lists';
export type PayloadPolicy = 'last_wins' | 'first_wins' | 'union' | 'preserve';

/** Reference to a recipient payload field in a ``core.webhook_out.body``
 *  leaf, mirroring backend
 *  ``request_body_contract`` ``{"$payload": "field_name"}``. */
export interface PayloadRef {
  $payload: string;
}

export type StructuredRequestBody =
  | string
  | number
  | boolean
  | null
  | PayloadRef
  | StructuredRequestBody[]
  | { [key: string]: StructuredRequestBody };
