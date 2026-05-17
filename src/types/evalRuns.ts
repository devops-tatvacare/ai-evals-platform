/* TypeScript interfaces mirroring Python data models */

// ═══════════════════════════════════════════════════════════════
// Output field / evaluator descriptor types (shared across all eval UIs)
// ═══════════════════════════════════════════════════════════════

/** Definition of a single output field from an evaluator's schema. */
export interface OutputFieldDef {
  key: string;
  label?: string;
  type: 'number' | 'text' | 'boolean' | 'array' | 'enum';
  description?: string;
  isMainMetric?: boolean;
  thresholds?: { green: number; yellow?: number; red?: number };
  displayMode?: 'badge' | 'bar' | 'hidden' | 'header' | 'card';  // Legacy, prefer role
  enumValues?: string[];
  role?: 'metric' | 'detail' | 'reasoning';  // v2
}

/** Describes how to render an evaluator's results in the UI. */
export interface EvaluatorDescriptor {
  id: string;
  name: string;
  type: 'built-in' | 'custom';
  outputSchema?: OutputFieldDef[];
  primaryField?: {
    key: string;
    format: 'verdict' | 'percentage' | 'number' | 'boolean' | 'text';
    verdictOrder?: string[];
  };
  aggregation?: {
    distribution?: Record<string, number>;
    average?: number;
    completedCount: number;
    errorCount: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Unified EvalRun type — single source of truth for ALL evaluations
// ═══════════════════════════════════════════════════════════════

export type EvalType = 'custom' | 'full_evaluation' | 'call_quality' | 'batch_thread' | 'batch_adversarial';

/**
 * Lifecycle status the backend writes to ``eval_runs.status``. Mirrors the
 * values produced by the runners in
 * ``backend/app/services/evaluators/*_runner.py``.
 *
 * - ``pending`` / ``running`` are non-terminal — the run is still going.
 * - ``completed`` / ``completed_with_errors`` / ``failed`` / ``cancelled``
 *   are terminal — the run will not change state again.
 *
 * The terminal set is exposed as ``TERMINAL_RUN_STATUSES`` so polling
 * surfaces (Logs live indicator, run-detail watchers) stay in sync without
 * each duplicating the list — a divergence here is what caused old runs
 * with partial failures to show as "Live" forever.
 */
export type EvalRunLifecycleStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export const TERMINAL_RUN_STATUSES: ReadonlySet<EvalRunLifecycleStatus> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
]);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status.toLowerCase() as EvalRunLifecycleStatus);
}

export interface EvalRun {
  id: string;
  appId: string;
  evalType: EvalType;
  listingId?: string;
  sessionId?: string;
  evaluatorId?: string;
  jobId?: string;
  status: EvalRunLifecycleStatus;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  llmProvider?: string;
  llmModel?: string;
  config: Record<string, unknown>;
  result?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  batchMetadata?: Record<string, unknown>;
  evaluatorDescriptors?: EvaluatorDescriptor[];
  flowType?: string;
  createdAt: string;
  userId?: string;
  tenantId?: string;
  visibility?: 'private' | 'shared';
  sharedBy?: string | null;
  sharedAt?: string | null;
  latestReviewId?: string | null;
  ownerName?: string | null;
  // Legacy compat fields from _run_to_dict
  run_id?: string;
  command?: string;
  name?: string;
  description?: string;
  data_path?: string;
  data_file_hash?: string;
  eval_temperature?: number;
  total_items?: number;
  duration_seconds?: number;
  flags?: Record<string, unknown>;
  timestamp?: string;
}

// ═══════════════════════════════════════════════════════════════
// Batch/Adversarial run types
// ═══════════════════════════════════════════════════════════════

export type CorrectnessVerdict =
  | "PASS"
  | "SOFT FAIL"
  | "HARD FAIL"
  | "CRITICAL"
  | "NOT APPLICABLE";

export type EfficiencyVerdict =
  | "EFFICIENT"
  | "ACCEPTABLE"
  | "INCOMPLETE"
  | "FRICTION"
  | "BROKEN"
  | "NOT APPLICABLE";

export type AdversarialVerdict =
  | "PASS"
  | "SOFT FAIL"
  | "HARD FAIL"
  | "CRITICAL";

export type RunStatus = "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "INTERRUPTED" | "CANCELLED";

export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "CRACK" | "MORIARTY";

export type RecoveryQuality = "GOOD" | "PARTIAL" | "FAILED" | "NOT NEEDED";

export type FrictionCause = "USER" | "BOT";
export type RuleOutcomeStatus = 'FOLLOWED' | 'VIOLATED' | 'NOT_APPLICABLE' | 'NOT_EVALUATED';

export interface Run {
  run_id: string;
  id?: string;
  command: string;
  timestamp: string;
  llm_provider: string;
  llm_model: string;
  eval_temperature: number;
  data_path: string;
  data_file_hash: string;
  flags: Record<string, unknown>;
  duration_seconds: number;
  status: RunStatus;
  error_message: string | null;
  summary: Record<string, unknown>;
  config?: Record<string, unknown>;
  batch_metadata?: Record<string, unknown>;
  total_items: number;
  name: string | null;
  description: string | null;
  job_id: string | null;
  evaluator_descriptors?: EvaluatorDescriptor[];
  visibility?: 'private' | 'shared';
  shared_by?: string | null;
  shared_at?: string | null;
  latest_review_id?: string | null;
  userId?: string;
  tenantId?: string;
  ownerName?: string | null;
}

export interface PreviewResponse {
  totalMessages: number;
  totalThreads: number;
  totalUsers: number;
  dateRange: { start: string; end: string } | null;
  threadIds: string[];
  intentDistribution: Record<string, number>;
  messagesWithErrors: number;
  messagesWithImages: number;
}

export interface ThreadEvalRow {
  id: number;
  run_id: string;
  thread_id: string;
  data_file_hash: string;
  intent_accuracy: number | null;
  worst_correctness: CorrectnessVerdict | null;
  efficiency_verdict: EfficiencyVerdict | null;
  success_status: number;
  result: ThreadEvalResult;
  canonical_thread?: CanonicalThreadEvaluation;
  created_at: string;
}

export interface CustomEvaluationResult {
  evaluator_id: string;
  evaluator_name: string;
  status: "completed" | "failed";
  output?: Record<string, unknown>;
  error?: string;
}

export interface ThreadEvalResult {
  /** Present when the thread evaluation failed (e.g. LLM timeout). */
  error?: string;
  thread: {
    thread_id: string;
    user_id: string;
    message_count: number;
    duration_seconds: number;
    messages: ChatMessage[];
  };
  intent_evaluations: IntentEvaluation[];
  correctness_evaluations: CorrectnessEvaluation[];
  efficiency_evaluation: EfficiencyEvaluation | null;
  intent_accuracy: number;
  worst_correctness_verdict: CorrectnessVerdict;
  efficiency_verdict: EfficiencyVerdict | null;
  success_status: boolean;
  correctness_summary: Record<string, number>;
  custom_evaluations?: Record<string, CustomEvaluationResult>;
  canonical_thread?: CanonicalThreadEvaluation;
  /** Map of evaluator name → error message for evaluators that threw during execution. */
  failed_evaluators?: Record<string, string>;
  /** List of evaluator names that were disabled in the run config (e.g. ["intent", "efficiency"]). */
  skipped_evaluators?: string[];
}

export interface ChatMessage {
  query_text: string;
  final_response_message: string;
  intent_detected: string;
  intent_query_type?: string;
  has_image: boolean;
  timestamp: string;
}

export interface IntentEvaluation {
  message: ChatMessage;
  predicted_intent: string;
  predicted_query_type?: string;
  is_correct_intent: boolean;
  is_correct_query_type?: boolean | null;  // null when ground truth unavailable
  confidence: number;
  reasoning: string;
  all_predictions?: Record<string, unknown>;
}

export interface CorrectnessEvaluation {
  message: ChatMessage;
  verdict: CorrectnessVerdict;
  has_image_context: boolean;
  calorie_sanity: Record<string, unknown>;
  arithmetic_consistency: Record<string, unknown>;
  quantity_coherence: Record<string, unknown>;
  reasoning: string;
  rule_compliance: RuleCompliance[];
}

export interface EfficiencyEvaluation {
  verdict: EfficiencyVerdict;
  task_completed: boolean;
  friction_turns: FrictionTurn[];
  recovery_quality: RecoveryQuality;
  /** Root cause when task_completed is false. Empty string when task completed. */
  failure_reason: string;
  /** @deprecated Old field name — use failure_reason. Present in pre-migration JSONB records. */
  abandonment_reason?: string;
  reasoning: string;
  rule_compliance: RuleCompliance[];
}

export interface FrictionTurn {
  turn: number;
  cause: FrictionCause;
  description: string;
}

export interface RuleCompliance {
  rule_id: string;
  section: string;
  followed: boolean | null;
  evidence: string;
  status?: RuleOutcomeStatus;
}

export interface CanonicalGoalVerdict {
  goalId: string;
  achieved: boolean;
  reasoning?: string;
}

export interface CanonicalRuleOutcome {
  ruleId: string;
  status: RuleOutcomeStatus;
  evidence: string;
  section?: string;
}

export type CanonicalEfficiencyVerdict =
  | 'EFFICIENT'
  | 'ACCEPTABLE'
  | 'INCOMPLETE'
  | 'FRICTION'
  | 'BROKEN'
  | 'NOT_APPLICABLE';

export type CanonicalCorrectnessVerdict =
  | 'PASS'
  | 'SOFT_FAIL'
  | 'HARD_FAIL'
  | 'CRITICAL'
  | 'NOT_APPLICABLE';

export interface CanonicalThreadRuleSource {
  sourceType: 'efficiency' | 'correctness';
  sourceLabel: string;
  ruleId: string;
  status: RuleOutcomeStatus;
  followed: boolean | null;
  evidence: string;
  section?: string;
}

export interface CanonicalThreadRuleOutcome {
  ruleId: string;
  status: RuleOutcomeStatus;
  followed: boolean | null;
  evidence: string;
  section?: string;
  sources: CanonicalThreadRuleSource[];
}

export interface CanonicalCorrectnessThreadEvaluation {
  message: ChatMessage;
  verdict: CanonicalCorrectnessVerdict | null;
  reasoning: string;
  hasImageContext: boolean;
  calorieSanity: Record<string, unknown>;
  arithmeticConsistency: Record<string, unknown>;
  quantityCoherence: Record<string, unknown>;
  ruleOutcomes: CanonicalThreadRuleSource[];
}

export interface CanonicalThreadEvaluation {
  version?: number;
  facts: {
    thread: {
      threadId: string;
      userId: string;
      messageCount: number;
      durationSeconds: number;
      hasImage: boolean;
    };
    execution: {
      failedEvaluators: Record<string, string>;
      skippedEvaluators: string[];
      hadEvaluationError: boolean;
    };
  };
  evaluators: {
    intent: {
      accuracy: number | null;
      evaluations: IntentEvaluation[];
    };
    efficiency: {
      verdict: CanonicalEfficiencyVerdict | null;
      taskCompleted: boolean;
      frictionTurns: FrictionTurn[];
      recoveryQuality: string | null;
      failureReason: string;
      reasoning: string;
      ruleOutcomes: CanonicalThreadRuleSource[];
    };
    correctness: {
      worstVerdict: CanonicalCorrectnessVerdict | null;
      evaluations: CanonicalCorrectnessThreadEvaluation[];
    };
    custom: Record<string, CustomEvaluationResult>;
  };
  derived: {
    successStatus: boolean;
    worstCorrectnessVerdict: CanonicalCorrectnessVerdict | null;
    efficiencyVerdict: CanonicalEfficiencyVerdict | null;
    canonicalRuleOutcomes: CanonicalThreadRuleOutcome[];
    ruleComplianceSummary: {
      followed: number;
      violated: number;
      notApplicable: number;
      notEvaluated: number;
      evaluatedCount: number;
    };
  };
}

export interface CanonicalAdversarialCase {
  facts: {
    testCase: {
      goalFlow: string[];
      difficulty?: Difficulty;
      activeTraits: string[];
      syntheticInput: string;
      expectedChallenges: string[];
    };
    transcript: {
      turns: TranscriptTurn[];
      turnCount: number;
    };
    transport: {
      hadHttpError: boolean;
      hadStreamError: boolean;
      hadTimeout?: boolean;
      hadEmptyFinalAssistantMessage?: boolean;
      hadPartialResponse?: boolean;
      httpErrors: string[];
      streamErrors: string[];
    };
    simulator: {
      goalAchieved: boolean;
      goalAbandoned: boolean;
      goalsAttempted: string[];
      goalsCompleted: string[];
      goalsAbandoned: string[];
      goalTransitions: { goal_id?: string; goalId?: string; event: string; at_turn?: number; atTurn?: number }[];
      stopReason: string;
      failureReason: string;
    };
  };
  judge: {
    verdict: AdversarialVerdict | null;
    goalAchieved: boolean;
    goalVerdicts: CanonicalGoalVerdict[];
    ruleOutcomes: CanonicalRuleOutcome[];
    failureModes: string[];
    reasoning?: string;
  };
  derived: {
    hasContradiction: boolean;
    contradictionTypes: string[];
    isInfraFailure: boolean;
    isRetryable?: boolean;
  };
  contract?: {
    version?: number;
    flowMode?: string;
    goalIds?: string[];
    traitIds?: string[];
    ruleIds?: string[];
    selectedRuleIds?: string[];
  };
}

export interface AdversarialEvalRow {
  id: number;
  run_id: string;
  goal_flow: string[];
  active_traits: string[];
  difficulty: Difficulty;
  verdict: AdversarialVerdict | null;  // null = infra failure (rate limit, timeout, etc.)
  goal_achieved: boolean;
  total_turns: number;
  result: AdversarialResult;
  canonical_case?: CanonicalAdversarialCase;
  has_contradiction?: boolean;
  contradiction_types?: string[];
  is_infra_failure?: boolean;
  is_retryable?: boolean;
  error: string | null;               // set when verdict is null
  created_at: string;
}

export interface AdversarialResult {
  test_case: {
    goal_flow: string[];
    active_traits: string[];
    difficulty: Difficulty;
    synthetic_input: string;
    expected_behavior: string;
    expected_challenges: string[];
  };
  transcript?: {
    turns: TranscriptTurn[];
    total_turns: number;
    goal_achieved: boolean;
    failure_reason: string;
    goals_attempted?: string[];
    goals_completed?: string[];
    goals_abandoned?: string[];
    goal_transitions?: { goal_id: string; event: string; at_turn: number }[];
    /** @deprecated Old field name — use failure_reason. Present in pre-migration JSONB records. */
    abandonment_reason?: string;
  };
  verdict?: AdversarialVerdict;
  failure_modes?: string[];
  reasoning?: string;
  goal_achieved?: boolean;
  goal_verdicts?: { goal_id: string; achieved: boolean; reasoning?: string }[];
  rule_compliance?: RuleCompliance[];
  canonical_case?: CanonicalAdversarialCase;
  /** Aggregated persona tactic signals for adversarial personas (Moriarty, ...). */
  persona_tactic_summary?: PersonaTacticSummary;
  error?: string;  // set on infra failure (verdict=null)
}

export interface PersonaTacticSummary {
  tactics_attempted: string[];
  tactics_landed: string[];
  turn_tactic_sequence: Array<{ turn_number: number; persona_tactic: string }>;
  persona_rule_compliance: Array<{
    rule_id: string;
    status: 'FOLLOWED' | 'VIOLATED' | 'NOT_APPLICABLE' | 'NOT_EVALUATED';
    evidence: string;
  }>;
}

export interface TranscriptTurn {
  turn_number: number;
  user_message: string;
  bot_response: string;
  detected_intent: string;
  /**
   * Per-turn goal signals. Populated by the conversation agent. When an
   * adversarial persona is active, this carries the `persona_tactic` the
   * agent used on this turn (`"none"` for non-adversarial turns).
   */
  goal_signals?: Record<string, unknown>;
  /**
   * Structured widget the bot rendered on this turn (food_card, food_card_batch,
   * bp_card, vitals_card, or a forward-compat unknown kind). Absent when the
   * turn produced no widget.
   * `is_known === false` means the platform doesn't yet have a renderer/grammar
   * for the kind — UI shows an UnsupportedWidgetPlaceholder.
   */
  assistant_widget?: {
    kind: string;
    data: unknown;
    is_known: boolean;
  };
  /**
   * Action descriptor when this turn was an auto-confirm button press from
   * the simulator. Mirrors the chip/pill the production app shows when the
   * user taps a widget button. Absent for free-text turns.
   */
  user_action?: {
    kind: string;
    label: string;
    wire: string;
    verbs?: string[];
    payload?: unknown;
  };
}

export interface SummaryStats {
  total_runs: number;
  total_threads_evaluated: number;
  total_adversarial_tests: number;
  correctness_distribution: Record<string, number>;
  efficiency_distribution: Record<string, number>;
  adversarial_distribution: Record<string, number>;
  avg_intent_accuracy: number | null;
  intent_distribution: Record<string, number>;
}

export interface TrendEntry {
  day: string;
  worst_correctness: CorrectnessVerdict;
  cnt: number;
}

export interface ApiLogEntry {
  id: number;
  run_id: string;
  thread_id: string | null;
  test_case_label: string | null;
  provider: string;
  model: string;
  method: string;
  prompt: string;
  system_prompt: string | null;
  response: string | null;
  error: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
  eval_type: string | null;
  run_name: string | null;
}
