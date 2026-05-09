export type WorkflowType = 'crm' | 'clinical';
export type WorkflowVisibilityFilter = 'all' | 'private' | 'shared';

// Single source of truth for workflow-type pickers. Order is the display order
// in the create-workflow surface. Adding a new workflow type means: extend the
// `WorkflowType` union above, add the matching backend node namespace, and add
// the row here — the picker auto-updates.
export const WORKFLOW_TYPE_OPTIONS: ReadonlyArray<{ value: WorkflowType; label: string }> = [
  { value: 'crm', label: 'CRM' },
  { value: 'clinical', label: 'Clinical' },
];

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

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['pending', 'running', 'waiting'];

export function isRunActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

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

/** One parse issue annotated onto a node by the Zod boundary. Mirrors
 *  `FieldErrorItem` so the canvas banner can render through the same
 *  `<PublishErrorPanel>` renderer downstream. */
export interface NodeParseIssue {
  field: string;
  message: string;
  code: string;
}

export interface WorkflowDefinitionNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label?: string; nodeType?: string };
  config: Record<string, unknown>;
  /** Phase 14 / Phase D — populated by the store when `parseNodeConfig`
   *  returns issues at hydrate or `updateNodeConfig`. UI surfaces this on
   *  the canvas banner (see `Canvas.tsx`); the field is stripped before
   *  the node hits the wire (`toDefinition`). Never persisted. */
  _parseIssues?: NodeParseIssue[];
}

export interface WorkflowDefinitionEdge {
  id: string;
  source: string;
  target: string;
  /**
   * Canonical Phase 11 routing key. Matches the persisted JSONB shape
   * (snake_case) — the wire format from
   * ``GET /api/orchestration/workflows/{id}/versions`` returns ``output_id``
   * because ``WorkflowDefinition.edges`` is typed as a raw dict on the
   * backend and bypasses the camelCase alias generator. Frontend persists
   * with this key too so round-trips stay lossless.
   */
  output_id?: string;
  /**
   * Legacy alias — older saved definitions and earlier frontend builds
   * persisted ``outputId`` (camelCase). Accepted on read; never written.
   */
  outputId?: string;
  /**
   * Pre-Phase-11 legacy field — accepted on read so old saved definitions
   * still hydrate. Backend normalizer migrates ``label → output_id``.
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
  visibility: 'private' | 'shared';
  sharedBy: string | null;
  sharedAt: string | null;
  /** Resolved display name of the creator. `null` when the workflow was
   *  seeded by the system user, or when the creator's row was deleted.
   *  Surfaces in the campaigns listing's "Created by" column. */
  createdByName: string | null;
  /** Resolved email of the creator. Same null-cases as `createdByName`. */
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
  /** Most-recent run id / timestamp / status, projected by the backend.
   *  All three are NULL when the workflow has never been run. System
   *  workflows always carry NULLs (templates aren't runnable directly). */
  lastRunId: string | null;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
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

export interface WorkflowRunNodeStep {
  id: string;
  nodeId: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  inputsSummary: Record<string, unknown>;
  outputsSummary: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunOverlaySnapshot {
  run: WorkflowRun;
  nodeSteps: WorkflowRunNodeStep[];
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
  providerCorrelationId?: string | null;
  providerStatus?: string | null;
  providerTerminal?: boolean;
  error: string | null;
  parentActionId: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Phase 15.1b — denormalized row from `GET /api/orchestration/actions`
 *  (tenant-wide). Carries workflow + run identity inline so the Logs
 *  "Workflow actions" tab can render a linked workflow column without
 *  extra round-trips, and so the row click can deep-link into the Logs
 *  action-detail sub-route with its parent run context. */
export interface WorkflowActionGlobalRow {
  id: string;
  workflowId: string;
  workflowName: string | null;
  runId: string;
  recipientId: string;
  channel: string;
  actionType: string;
  status: string;
  providerCorrelationId: string | null;
  providerStatus: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkflowActionListResponse {
  items: WorkflowActionGlobalRow[];
  total: number;
  limit: number;
  offset: number;
}

const PENDING_PROVIDER_OUTCOMES = new Set(['bolna_queued']);

function stringField(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value || null;
  if (typeof value === 'number') return String(value);
  return null;
}

export function getActionProviderStatus(action: ActionRow): string | null {
  const direct = stringField(action.providerStatus);
  if (direct) return direct;
  const response = (action.response ?? {}) as Record<string, unknown>;
  return stringField(response.provider_status) ?? stringField(response.status);
}

export function isActionProviderTerminal(action: ActionRow): boolean {
  if (action.providerTerminal === true) return true;
  const response = (action.response ?? {}) as Record<string, unknown>;
  return response.provider_terminal === true;
}

export function isActionAwaitingProviderOutcome(action: ActionRow): boolean {
  return (
    (action.channel || '').toLowerCase() === 'bolna' &&
    (action.actionType || '').toLowerCase() === 'bolna_queued' &&
    !isActionProviderTerminal(action)
  );
}

export function getRecipientLastOutcome(recipient: RecipientState): string | null {
  const payload = (recipient.payload ?? {}) as Record<string, unknown>;
  return stringField(payload.last_outcome);
}

export function isRecipientAwaitingProviderOutcome(recipient: RecipientState): boolean {
  const outcome = getRecipientLastOutcome(recipient);
  return outcome ? PENDING_PROVIDER_OUTCOMES.has(outcome.toLowerCase()) : false;
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
  return edge.output_id ?? edge.outputId ?? edge.label ?? 'default';
}

// ─── Phase 11 (Commit 2) — specialized editor contracts ─────────────────────

export type CohortSourceKind = 'static' | 'dataset';
export type CohortColumnType = 'integer' | 'number' | 'boolean' | 'datetime' | 'string';

export interface CohortSourceSchemaDescriptor {
  columns: Array<{
    name: string;
    type: CohortColumnType;
    sampleValues?: string[];
    distinctCount?: number;
  }>;
  rowCount?: number;
}

export interface CohortSource {
  sourceRef: string;
  displayLabel: string;
  description: string;
  /** Discriminates the engineering-owned static catalog (``'static'``) from
   *  tenant-owned dataset versions (``'dataset'``) added in Phase 12. The
   *  backend derives the dataset shape's allowed-column lists from the
   *  persisted ``schema_descriptor``; the frontend treats both the same
   *  except for grouping in the source picker. */
  kind: CohortSourceKind;
  workflowTypes: string[];
  appIds: string[];
  idColumn: string;
  allowedPayloadColumns: string[];
  allowedFilterColumns: string[];
  allowedLookbackColumns: string[];
  schemaDescriptor?: CohortSourceSchemaDescriptor | null;
  rowCount?: number | null;
  importedAt?: string | null;
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
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'exists'
  | 'missing';

export interface LeafPredicate {
  field: string;
  op: PredicateOp;
  value?: unknown;
}

export interface AndPredicate {
  and: PredicateAst[];
}

export interface OrPredicate {
  or: PredicateAst[];
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
