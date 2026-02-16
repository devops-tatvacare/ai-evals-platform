/* TypeScript interfaces mirroring Python data models */

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

export interface ThreadEvalResult {
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
  verdict: AdversarialVerdict;
  goal_achieved: number;
  total_turns: number;
  result: AdversarialResult;
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
  transcript: {
    turns: TranscriptTurn[];
    total_turns: number;
    goal_achieved: boolean;
    abandonment_reason: string;
  };
  verdict: AdversarialVerdict;
  failure_modes: string[];
  reasoning: string;
  goal_achieved: boolean;
  rule_compliance: RuleCompliance[];
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
