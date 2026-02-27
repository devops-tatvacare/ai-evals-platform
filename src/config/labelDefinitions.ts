/**
 * Centralized label and metric definitions with semantic metadata.
 *
 * CANONICAL FORMAT: All verdict/label values use UPPERCASE WITH SPACES.
 * Example: "SOFT FAIL", "NOT APPLICABLE", "NOT NEEDED"
 *
 * The lookup functions normalize any input (underscores, mixed case) to
 * canonical format before matching, so both "SOFT_FAIL" and "SOFT FAIL"
 * resolve correctly.
 */

import { STATUS_COLORS, CATEGORY_ACCENT_COLORS } from '@/utils/statusColors';

export interface LabelDefinition {
  value: string;
  displayName: string;
  description: string;
  tooltip: string;
  severity: number; // 0 = best, higher = worse
  color: string;
}

export interface MetricDefinition {
  key: string;
  displayName: string;
  description: string;
  tooltip: string;
  unit: string;
}

// ─── CORRECTNESS VERDICTS ─────────────────────────────────────────────

export const CORRECTNESS_VERDICTS: Record<string, LabelDefinition> = {
  "PASS": {
    value: "PASS",
    displayName: "Pass",
    description: "All nutritional checks pass",
    tooltip:
      "Meal summary is nutritionally accurate. Calories are plausible, arithmetic is correct, and quantities match user input.",
    severity: 0,
    color: STATUS_COLORS.pass,
  },
  "SOFT FAIL": {
    value: "SOFT FAIL",
    displayName: "Soft Fail",
    description: "Minor nutritional issues",
    tooltip:
      "Minor issues like borderline calorie estimates or small quantity mismatches. Summary is usable but imperfect.",
    severity: 1,
    color: STATUS_COLORS.softFail,
  },
  "HARD FAIL": {
    value: "HARD FAIL",
    displayName: "Hard Fail",
    description: "Clear nutritional inaccuracy",
    tooltip:
      "Significant errors like calorie hallucination, arithmetic mistakes, or incorrect food quantities. Summary is unreliable.",
    severity: 2,
    color: STATUS_COLORS.hardFail,
  },
  "CRITICAL": {
    value: "CRITICAL",
    displayName: "Critical",
    description: "Order-of-magnitude calorie error",
    tooltip:
      "Severe nutritional error with order-of-magnitude calorie mistakes (e.g., 2000 instead of 200). Dangerous for user health tracking.",
    severity: 3,
    color: STATUS_COLORS.critical,
  },
  "NOT APPLICABLE": {
    value: "NOT APPLICABLE",
    displayName: "N/A",
    description: "Not a meal summary",
    tooltip:
      "Response is not a meal summary (e.g., clarification question, greeting). No correctness evaluation needed.",
    severity: -1,
    color: STATUS_COLORS.na,
  },
};

export const CORRECTNESS_SEVERITY_ORDER = [
  "NOT APPLICABLE",
  "PASS",
  "SOFT FAIL",
  "HARD FAIL",
  "CRITICAL",
];

// ─── EFFICIENCY VERDICTS ──────────────────────────────────────────────

export const EFFICIENCY_VERDICTS: Record<string, LabelDefinition> = {
  "EFFICIENT": {
    value: "EFFICIENT",
    displayName: "Efficient",
    description: "Clean 2-turn completion",
    tooltip:
      "Completed in 2 turns or fewer. User described food, bot produced correct summary with action chips on the first attempt \u2014 no clarification needed.",
    severity: 0,
    color: STATUS_COLORS.efficient,
  },
  "ACCEPTABLE": {
    value: "ACCEPTABLE",
    displayName: "Acceptable",
    description: "Extra turns due to missing user info",
    tooltip:
      "Took more than 2 turns, but every extra turn was the user\u2019s fault (didn\u2019t provide time, gave vague quantity, etc.). The bot behaved correctly \u2014 it asked the right clarifying questions.",
    severity: 1,
    color: STATUS_COLORS.acceptable,
  },
  "INCOMPLETE": {
    value: "INCOMPLETE",
    displayName: "Incomplete",
    description: "Conversation data ends before task outcome",
    tooltip:
      "The task did not complete, but the bot made no errors in the available turns. The conversation data is truncated or the user stopped before confirming. Excluded from completion rate calculations.",
    severity: -1,
    color: STATUS_COLORS.incomplete,
  },
  "FRICTION": {
    value: "FRICTION",
    displayName: "Friction",
    description: "Extra turns caused by bot error",
    tooltip:
      "At least one extra turn was caused by a bot mistake \u2014 e.g. re-asking for info already provided, guessing food from insufficient input, splitting a composite dish, or showing wrong calorie values.",
    severity: 2,
    color: STATUS_COLORS.friction,
  },
  "BROKEN": {
    value: "BROKEN",
    displayName: "Broken",
    description: "Bot error caused task failure",
    tooltip:
      "A bot error directly caused the task to fail \u2014 it ignored a user correction and logged wrong data, or the user abandoned because the bot could not recover from its own mistake.",
    severity: 3,
    color: STATUS_COLORS.broken,
  },
};

export const EFFICIENCY_SEVERITY_ORDER = [
  "INCOMPLETE",
  "EFFICIENT",
  "ACCEPTABLE",
  "FRICTION",
  "BROKEN",
];

// ─── ADVERSARIAL VERDICTS ─────────────────────────────────────────────

export const ADVERSARIAL_VERDICTS: Record<string, LabelDefinition> = {
  "PASS": {
    value: "PASS",
    displayName: "Pass",
    description: "System handled input correctly",
    tooltip:
      "System correctly handled the adversarial input and achieved the goal. All rules followed.",
    severity: 0,
    color: STATUS_COLORS.pass,
  },
  "SOFT FAIL": {
    value: "SOFT FAIL",
    displayName: "Soft Fail",
    description: "Minor issues, goal achieved",
    tooltip:
      "Minor issues (e.g., slightly ambiguous quantity handling) but goal was achieved. Acceptable for difficult inputs.",
    severity: 1,
    color: STATUS_COLORS.softFail,
  },
  "HARD FAIL": {
    value: "HARD FAIL",
    displayName: "Hard Fail",
    description: "Clear failure, goal not achieved",
    tooltip:
      "Clear failures like wrong food extracted, calorie hallucination, or ignored correction. Goal may not be achieved.",
    severity: 2,
    color: STATUS_COLORS.hardFail,
  },
  "CRITICAL": {
    value: "CRITICAL",
    displayName: "Critical",
    description: "Dangerous failure",
    tooltip:
      "Dangerous failures like order-of-magnitude calorie errors or completely wrong food logged. System broke under stress.",
    severity: 3,
    color: STATUS_COLORS.critical,
  },
};

export const ADVERSARIAL_SEVERITY_ORDER = [
  "PASS",
  "SOFT FAIL",
  "HARD FAIL",
  "CRITICAL",
];

// ─── INTENT VERDICTS ─────────────────────────────────────────────────

export const INTENT_VERDICTS: Record<string, LabelDefinition> = {
  "CORRECT": {
    value: "CORRECT",
    displayName: "Correct",
    description: "Intent correctly classified",
    tooltip:
      "The bot correctly identified the user's intent (e.g., meal logging vs. question).",
    severity: 0,
    color: STATUS_COLORS.correct,
  },
  "INCORRECT": {
    value: "INCORRECT",
    displayName: "Incorrect",
    description: "Intent misclassified",
    tooltip:
      "The bot misidentified the user's intent, which may lead to wrong conversation flow.",
    severity: 1,
    color: STATUS_COLORS.incorrect,
  },
};

export const INTENT_SEVERITY_ORDER = ["CORRECT", "INCORRECT"];

// ─── DIFFICULTY LEVELS ────────────────────────────────────────────────

export const DIFFICULTY_LEVELS: Record<string, LabelDefinition> = {
  "EASY": {
    value: "EASY",
    displayName: "Easy",
    description: "Straightforward input",
    tooltip:
      "Straightforward input with one minor ambiguity. Cooperative user. Zero tolerance \u2014 SOFT FAIL indicates a bug.",
    severity: 0,
    color: STATUS_COLORS.easy,
  },
  "MEDIUM": {
    value: "MEDIUM",
    displayName: "Medium",
    description: "Moderately tricky input",
    tooltip:
      "Moderately tricky input requiring clarification. Partial info or casual language. SOFT FAIL acceptable if goal achieved.",
    severity: 1,
    color: STATUS_COLORS.medium,
  },
  "HARD": {
    value: "HARD",
    displayName: "Hard",
    description: "Genuinely adversarial input",
    tooltip:
      "Genuinely adversarial input with multiple ambiguities stacked. Vague or difficult user. SOFT FAIL is a good result.",
    severity: 2,
    color: STATUS_COLORS.hard,
  },
};

export const DIFFICULTY_SEVERITY_ORDER = ["EASY", "MEDIUM", "HARD"];

// ─── RUN STATUS ───────────────────────────────────────────────────────

export const RUN_STATUS_LABELS: Record<string, LabelDefinition> = {
  "RUNNING": {
    value: "RUNNING",
    displayName: "Running",
    description: "Execution in progress",
    tooltip: "Evaluation run is currently executing.",
    severity: 0,
    color: STATUS_COLORS.running,
  },
  "COMPLETED": {
    value: "COMPLETED",
    displayName: "Completed",
    description: "Execution finished successfully",
    tooltip: "Evaluation run finished successfully without errors.",
    severity: 0,
    color: STATUS_COLORS.completed,
  },
  "COMPLETED WITH ERRORS": {
    value: "COMPLETED WITH ERRORS",
    displayName: "Partial",
    description: "Execution finished with some thread failures",
    tooltip: "Evaluation run completed but some threads failed. Results are from successful threads only.",
    severity: 1,
    color: STATUS_COLORS.completedWithErrors,
  },
  "FAILED": {
    value: "FAILED",
    displayName: "Failed",
    description: "Execution encountered error",
    tooltip: "Evaluation run encountered an error and did not complete.",
    severity: 1,
    color: STATUS_COLORS.failed,
  },
  "INTERRUPTED": {
    value: "INTERRUPTED",
    displayName: "Interrupted",
    description: "Execution interrupted by user",
    tooltip: "Evaluation run was interrupted by the user (Ctrl+C or SIGTERM).",
    severity: 1,
    color: STATUS_COLORS.interrupted,
  },
  "CANCELLED": {
    value: "CANCELLED",
    displayName: "Cancelled",
    description: "Execution cancelled by user",
    tooltip: "Evaluation run was cancelled by the user. Partial results may be available.",
    severity: 1,
    color: STATUS_COLORS.cancelled,
  },
  "SUCCESS": {
    value: "SUCCESS",
    displayName: "Completed",
    description: "Evaluator run finished successfully",
    tooltip: "Custom evaluator run completed successfully.",
    severity: 0,
    color: STATUS_COLORS.completed,
  },
  "ERROR": {
    value: "ERROR",
    displayName: "Failed",
    description: "Evaluator run encountered an error",
    tooltip: "Custom evaluator run encountered an error.",
    severity: 1,
    color: STATUS_COLORS.failed,
  },
};

// ─── RECOVERY QUALITY ─────────────────────────────────────────────────

export const RECOVERY_QUALITY_LABELS: Record<string, LabelDefinition> = {
  "GOOD": {
    value: "GOOD",
    displayName: "Recovery: Good",
    description: "Bot fixed issue correctly",
    tooltip: "User pointed out an error and the bot corrected it immediately in the next response \u2014 updated the summary, recalculated calories, and got it right.",
    severity: 0,
    color: STATUS_COLORS.good,
  },
  "PARTIAL": {
    value: "PARTIAL",
    displayName: "Recovery: Partial",
    description: "Bot partially fixed issue",
    tooltip: "User corrected the bot, and it fixed some aspects but not all \u2014 e.g. updated the food item but kept the wrong calorie value, or needed a second correction to get it right.",
    severity: 1,
    color: STATUS_COLORS.partial,
  },
  "FAILED": {
    value: "FAILED",
    displayName: "Recovery: Failed",
    description: "Bot ignored correction",
    tooltip: "User explicitly corrected the bot (e.g. \u201Cno, it was 3 rotis not 2\u201D) but the bot ignored the correction, repeated the same error, or introduced a new one. Critical failure.",
    severity: 2,
    color: STATUS_COLORS.failedRecovery,
  },
  "NOT NEEDED": {
    value: "NOT NEEDED",
    displayName: "Recovery: N/A",
    description: "No corrections were needed",
    tooltip: "The user never needed to correct the bot during this conversation \u2014 either the bot got it right from the start, or the conversation didn\u2019t reach a point where correction was relevant.",
    severity: -1,
    color: STATUS_COLORS.notNeeded,
  },
};

// ─── TASK COMPLETION ──────────────────────────────────────────────────

export const TASK_COMPLETION_LABELS: Record<string, LabelDefinition> = {
  "COMPLETED": {
    value: "COMPLETED",
    displayName: "\u2713 Task Completed",
    description: "Conversation goal was achieved",
    tooltip:
      "The conversation reached its goal \u2014 the user\u2019s meal was logged or their question was answered successfully.",
    severity: 0,
    color: STATUS_COLORS.completed,
  },
  "NOT COMPLETED": {
    value: "NOT COMPLETED",
    displayName: "\u2717 Task Incomplete",
    description: "Conversation goal was not achieved",
    tooltip:
      "The conversation did not reach its goal \u2014 the meal was not logged or the question went unanswered, possibly due to bot errors or the conversation hitting max turns.",
    severity: 1,
    color: STATUS_COLORS.failed,
  },
};

// ─── FRICTION CAUSE ───────────────────────────────────────────────────

export const FRICTION_CAUSE_LABELS: Record<string, LabelDefinition> = {
  "USER": {
    value: "USER",
    displayName: "User",
    description: "Missing user information",
    tooltip:
      "Extra turn caused by genuinely missing user information (not bot's fault).",
    severity: 0,
    color: STATUS_COLORS.user,
  },
  "BOT": {
    value: "BOT",
    displayName: "Bot",
    description: "Bot error",
    tooltip:
      "Extra turn caused by a bot error (misunderstanding, wrong inference, incorrect summary).",
    severity: 1,
    color: STATUS_COLORS.bot,
  },
};

// ─── ADVERSARIAL CATEGORIES ──────────────────────────────────────────
// Categories remain snake_case — they are identifiers, not display labels.

export const ADVERSARIAL_CATEGORIES: Record<string, LabelDefinition> = {
  ambiguous_quantity: {
    value: "ambiguous_quantity",
    displayName: "Ambiguous Quantity",
    description: "Unusual or ambiguous food quantities",
    tooltip:
      "Tests handling of unusual, informal, or ambiguous food quantities (e.g., 'a bunch of', 'some', '2 slices').",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.ambiguous_quantity,
  },
  multiple_meals_one_message: {
    value: "multiple_meals_one_message",
    displayName: "Multiple Meals One Message",
    description: "Multiple meals/times in one message",
    tooltip:
      "Tests handling of multiple meals or different times mentioned in a single user message.",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.multiple_meals_one_message,
  },
  user_corrects_bot: {
    value: "user_corrects_bot",
    displayName: "User Corrects Bot",
    description: "User corrects bot's interpretation",
    tooltip:
      "Tests whether bot correctly handles user corrections after initial interpretation.",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.user_corrects_bot,
  },
  edit_after_log: {
    value: "edit_after_log",
    displayName: "Edit After Log",
    description: "User edits meal after logging",
    tooltip:
      "Tests handling of meal edits after user has already confirmed and logged the entry.",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.edit_after_log,
  },
  future_meal_rejection: {
    value: "future_meal_rejection",
    displayName: "Future Meal Rejection",
    description: "User provides future time (should reject)",
    tooltip:
      "Tests whether bot correctly rejects future meal times (meals can only be logged for past/present).",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.future_meal_rejection,
  },
  no_food_mentioned: {
    value: "no_food_mentioned",
    displayName: "No Food Mentioned",
    description: "Quantity/time without food mentioned",
    tooltip:
      "Tests handling of messages with only quantity or time but no food item mentioned.",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.no_food_mentioned,
  },
  multi_ingredient_dish: {
    value: "multi_ingredient_dish",
    displayName: "Multi-Ingredient Dish",
    description: "Multi-ingredient dish as single item",
    tooltip:
      "Tests handling of composite dishes (e.g., 'porridge with almonds and honey') that should be treated as single items, not broken down.",
    severity: 0,
    color: CATEGORY_ACCENT_COLORS.multi_ingredient_dish,
  },
};

// ─── METRICS ──────────────────────────────────────────────────────────

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  intent_accuracy: {
    key: "intent_accuracy",
    displayName: "Judge Intent Accuracy",
    description: "Percentage of messages with correct intent classification",
    tooltip:
      "Measures how accurately the bot identifies user intent (meal logging vs. questions). Higher is better. Target: >95%.",
    unit: "%",
  },
  completion_rate: {
    key: "completion_rate",
    displayName: "Completion Rate",
    description: "Percentage of threads where the conversation goal was achieved",
    tooltip:
      "Threads where the conversation goal was achieved (e.g., meal logged, query answered). Higher is better. Target: >90%.",
    unit: "%",
  },
  pass_rate: {
    key: "pass_rate",
    displayName: "Pass Rate",
    description: "Percentage of adversarial tests that passed",
    tooltip:
      "Measures how often the system handles adversarial stress tests correctly. Higher is better. Target: >80%.",
    unit: "%",
  },
  goal_achievement: {
    key: "goal_achievement",
    displayName: "Goal Achievement",
    description: "Percentage of adversarial tests where goal was achieved",
    tooltip:
      "Measures how often the system achieves the conversation goal in adversarial tests. Higher is better. Target: >85%.",
    unit: "%",
  },
  avg_turns: {
    key: "avg_turns",
    displayName: "Avg Turns",
    description: "Average number of conversation turns",
    tooltip:
      "Measures conversation efficiency. Lower is better for meal logging. Target: <3 turns for easy inputs.",
    unit: "turns",
  },
  avg_intent_acc: {
    key: "avg_intent_acc",
    displayName: "Avg Judge Intent Accuracy",
    description: "Average intent classification accuracy across threads",
    tooltip:
      "Average percentage of correct intent predictions across all evaluated threads. Higher is better. Target: >95%.",
    unit: "%",
  },
  total_threads: {
    key: "total_threads",
    displayName: "Total Threads",
    description: "Total number of conversation threads evaluated",
    tooltip:
      "Total count of conversation threads included in this evaluation run.",
    unit: "threads",
  },
  total_tests: {
    key: "total_tests",
    displayName: "Total Tests",
    description: "Total number of adversarial tests executed",
    tooltip: "Total count of adversarial stress tests executed in this run.",
    unit: "tests",
  },
  message_count: {
    key: "message_count",
    displayName: "Messages",
    description: "Number of messages in conversation",
    tooltip: "Total number of user + bot messages in the conversation thread.",
    unit: "msgs",
  },
  total_runs: {
    key: "total_runs",
    displayName: "Total Runs",
    description: "Total number of evaluation runs",
    tooltip: "Total count of all evaluation runs (batch + adversarial) executed.",
    unit: "runs",
  },
  threads_evaluated: {
    key: "threads_evaluated",
    displayName: "Threads Evaluated",
    description: "Distinct threads evaluated across all runs",
    tooltip:
      "Total number of unique conversation threads that have been evaluated at least once.",
    unit: "threads",
  },
  adversarial_tests: {
    key: "adversarial_tests",
    displayName: "Adversarial Tests",
    description: "Total adversarial stress tests executed",
    tooltip:
      "Total count of live API adversarial stress tests executed across all runs.",
    unit: "tests",
  },
  completed: {
    key: "completed",
    displayName: "Completed",
    description: "Number of threads where the conversation goal was achieved",
    tooltip:
      "Count of threads where the conversation goal was achieved (e.g., meal logged, query answered).",
    unit: "threads",
  },
};

// ─── HELPER FUNCTIONS ─────────────────────────────────────────────────

export type LabelCategory =
  | "correctness"
  | "efficiency"
  | "adversarial"
  | "intent"
  | "difficulty"
  | "status"
  | "recovery"
  | "friction"
  | "category"
  | "task_completion";

const CATEGORY_MAP: Record<LabelCategory, Record<string, LabelDefinition>> = {
  correctness: CORRECTNESS_VERDICTS,
  efficiency: EFFICIENCY_VERDICTS,
  adversarial: ADVERSARIAL_VERDICTS,
  intent: INTENT_VERDICTS,
  difficulty: DIFFICULTY_LEVELS,
  status: RUN_STATUS_LABELS,
  recovery: RECOVERY_QUALITY_LABELS,
  friction: FRICTION_CAUSE_LABELS,
  category: ADVERSARIAL_CATEGORIES,
  task_completion: TASK_COMPLETION_LABELS,
};

/**
 * Look up a label definition, normalizing input to canonical format.
 *
 * Handles legacy formats: "SOFT_FAIL" → "SOFT FAIL", "completed" → "COMPLETED".
 * Adversarial categories (snake_case identifiers) are preserved as-is.
 */
export function getLabelDefinition(
  label: string,
  category: LabelCategory,
): LabelDefinition {
  const definitions = CATEGORY_MAP[category] ?? {};

  // Categories use snake_case identifiers; everything else normalizes to UPPERCASE SPACES
  const normalizedLabel =
    category === "category"
      ? label.toLowerCase()
      : label.replace(/_/g, " ").toUpperCase().trim();

  return (
    definitions[normalizedLabel] ?? {
      value: normalizedLabel,
      displayName: normalizedLabel
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "Unknown label",
      tooltip: `No definition available for "${label}"`,
      severity: 0,
      color: STATUS_COLORS.default,
    }
  );
}

export function getMetricDefinition(metricKey: string): MetricDefinition {
  return (
    METRIC_DEFINITIONS[metricKey] ?? {
      key: metricKey,
      displayName: metricKey
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()),
      description: "Unknown metric",
      tooltip: `No definition available for ${metricKey}`,
      unit: "",
    }
  );
}

/**
 * Get color for any verdict/label string.
 *
 * Normalizes input and checks all definition maps in priority order.
 * Use getLabelDefinition() directly when you know the category.
 */
export function getVerdictColor(verdict: string): string {
  const normalized = verdict.replace(/_/g, " ").toUpperCase().trim();

  // Check each map in order (most specific first)
  const maps = [
    CORRECTNESS_VERDICTS,
    EFFICIENCY_VERDICTS,
    ADVERSARIAL_VERDICTS,
    INTENT_VERDICTS,
    DIFFICULTY_LEVELS,
    RUN_STATUS_LABELS,
    RECOVERY_QUALITY_LABELS,
    FRICTION_CAUSE_LABELS,
  ];

  for (const map of maps) {
    const def = map[normalized];
    if (def) return def.color;
  }

  // Adversarial categories use lowercase keys
  const lower = verdict.toLowerCase().trim();
  const catDef = ADVERSARIAL_CATEGORIES[lower];
  if (catDef) return catDef.color;

  // Fallback palette for custom evaluator verdicts — consistent hash-based color
  const CUSTOM_VERDICT_PALETTE = [
    STATUS_COLORS.pass,
    STATUS_COLORS.softFail,
    STATUS_COLORS.acceptable,
    STATUS_COLORS.friction,
    STATUS_COLORS.hardFail,
    '#6b7280',
  ];
  const hash = normalized.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  return CUSTOM_VERDICT_PALETTE[Math.abs(hash) % CUSTOM_VERDICT_PALETTE.length];
}
