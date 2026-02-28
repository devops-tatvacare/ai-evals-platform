/**
 * Estimate total LLM API calls for a batch evaluation run.
 *
 * Built-in evaluator assessment levels (from backend):
 *   Intent      → message-level (1 call per message)
 *   Correctness → message-level (1 call per message)
 *   Efficiency  → thread-level  (1 call per thread)
 *   Custom      → thread-level  (1 call per thread each)
 */

export interface LLMCallEstimateInput {
  /** Built-in evaluator toggles (ignored when customOnly is true) */
  evaluators: { intent: boolean; correctness: boolean; efficiency: boolean };
  customOnly: boolean;
  customEvaluatorCount: number;

  /** Thread scope config */
  threadScope: 'all' | 'sample' | 'specific';
  sampleSize: number;
  selectedThreadCount: number;

  /** From CSV preview */
  totalThreads: number;
  totalMessages: number;
}

export interface LLMCallEstimate {
  total: number;
  isApproximate: boolean;
}

export function estimateLLMCalls(input: LLMCallEstimateInput): LLMCallEstimate {
  const {
    evaluators, customOnly, customEvaluatorCount,
    threadScope, sampleSize, selectedThreadCount,
    totalThreads, totalMessages,
  } = input;

  // Count message-level and thread-level evaluators
  const messageLevelCount = customOnly
    ? 0
    : (evaluators.intent ? 1 : 0) + (evaluators.correctness ? 1 : 0);

  const threadLevelCount = (customOnly ? 0 : (evaluators.efficiency ? 1 : 0))
    + customEvaluatorCount;

  // Effective thread count based on scope
  let effectiveThreads: number;
  if (threadScope === 'all') {
    effectiveThreads = totalThreads;
  } else if (threadScope === 'sample') {
    effectiveThreads = Math.min(sampleSize, totalThreads);
  } else {
    effectiveThreads = selectedThreadCount;
  }

  // Effective message count — exact only for "all" scope
  let effectiveMessages: number;
  let isApproximate = false;

  if (threadScope === 'all') {
    effectiveMessages = totalMessages;
  } else {
    // Proportional estimate
    effectiveMessages = totalThreads > 0
      ? Math.round(effectiveThreads * totalMessages / totalThreads)
      : 0;
    if (messageLevelCount > 0) {
      isApproximate = true;
    }
  }

  const total = (messageLevelCount * effectiveMessages)
    + (threadLevelCount * effectiveThreads);

  return { total, isApproximate };
}
