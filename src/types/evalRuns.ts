/* TypeScript interfaces mirroring Python data models */

// ═══════════════════════════════════════════════════════════════
// Output field / evaluator descriptor types (shared across all eval UIs)
// ═══════════════════════════════════════════════════════════════

/** Definition of a single output field from an evaluator's schema. */
export interface OutputFieldDef {
  key: string;
  label?: string;
  type: 'number' | 'text' | 'boolean' | 'array';
  description?: string;
  isMainMetric?: boolean;
  thresholds?: { green: number; yellow?: number; red?: number };
  displayMode?: 'badge' | 'bar' | 'hidden';
  enumValues?: string[];
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

export type EvalType = 'custom' | 'full_evaluation' | 'human' | 'batch_thread' | 'batch_adversarial';

export interface EvalRun {
  id: string;
  appId: string;
  evalType: EvalType;
  listingId?: string;
  sessionId?: string;
  evaluatorId?: string;
  jobId?: string;
  status: 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
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
// Batch/Adversarial run types (kaira-evals legacy)
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
  | "FRICTION"
  | "BROKEN";

export type AdversarialVerdict =
  | "PASS"
  | "SOFT FAIL"
  | "HARD FAIL"
  | "CRITICAL";

export type RunStatus = "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "INTERRUPTED" | "CANCELLED";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export type RecoveryQuality = "GOOD" | "PARTIAL" | "FAILED" | "NOT NEEDED";

export type FrictionCause = "USER" | "BOT";

export interface Run {
  run_id: string;
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
  total_items: number;
  name: string | null;
  description: string | null;
  job_id: string | null;
  evaluator_descriptors?: EvaluatorDescriptor[];
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
  /** Map of evaluator name → error message for evaluators that threw during execution. */
  failed_evaluators?: Record<string, string>;
  /** List of evaluator names that were disabled in the run config (e.g. ["intent", "efficiency"]). */
  skipped_evaluators?: string[];
}

export interface ChatMessage {
  query_text: string;
  final_response_message: string;
  intent_detected: string;
  has_image: boolean;
  timestamp: string;
}

export interface IntentEvaluation {
  message: ChatMessage;
  predicted_intent: string;
  is_correct_intent: boolean;
  confidence: number;
  reasoning: string;
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
  abandonment_reason: string;
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
  followed: boolean;
  evidence: string;
}

export interface AdversarialEvalRow {
  id: number;
  run_id: string;
  category: string;
  difficulty: Difficulty;
  verdict: AdversarialVerdict | null;  // null = infra failure (rate limit, timeout, etc.)
  goal_achieved: number;
  total_turns: number;
  result: AdversarialResult;
  error: string | null;               // set when verdict is null
  created_at: string;
}

export interface AdversarialResult {
  test_case: {
    category: string;
    difficulty: Difficulty;
    synthetic_input: string;
    expected_behavior: string;
    goal_type: string;
  };
  transcript?: {
    turns: TranscriptTurn[];
    total_turns: number;
    goal_achieved: boolean;
    abandonment_reason: string;
  };
  verdict?: AdversarialVerdict;
  failure_modes?: string[];
  reasoning?: string;
  goal_achieved?: boolean;
  rule_compliance?: RuleCompliance[];
  error?: string;  // set on infra failure (verdict=null)
}

export interface TranscriptTurn {
  turn_number: number;
  user_message: string;
  bot_response: string;
  detected_intent: string;
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
}
