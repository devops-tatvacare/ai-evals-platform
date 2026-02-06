import { historyRepository } from '@/services/storage';
import type {
  EvaluatorDefinition,
  EvaluatorRun,
  Listing,
  HistoryEntry,
  EvaluatorRunData,
  HistoryScores,
  HistoryAppId,
} from '@/types';

/**
 * Extract scores from evaluator output
 */
function extractScores(output: Record<string, unknown> | undefined, evaluator: EvaluatorDefinition): HistoryScores | null {
  if (!output) return null;

  // Find the main metric field
  const mainMetricField = evaluator.outputSchema.find(f => f.isMainMetric);
  
  if (!mainMetricField) {
    // No main metric defined, store raw output
    return {
      overall_score: null,
      max_score: null,
      breakdown: output,
      reasoning: null,
      metadata: null,
    };
  }

  const overallScore = output[mainMetricField.key];
  
  // Build breakdown from all displayable fields
  const breakdown: Record<string, unknown> = {};
  for (const field of evaluator.outputSchema) {
    if (field.displayMode !== 'hidden' && output[field.key] !== undefined) {
      breakdown[field.key] = output[field.key];
    }
  }

  // Try to find reasoning field (common patterns)
  const reasoningField = evaluator.outputSchema.find(
    f => f.key.toLowerCase().includes('reason') || 
         f.key.toLowerCase().includes('explanation') ||
         f.key.toLowerCase().includes('comment')
  );
  const reasoning = reasoningField ? String(output[reasoningField.key] || '') : null;

  // Determine max score based on field type and thresholds
  let maxScore = null;
  if (mainMetricField.type === 'number' && mainMetricField.thresholds) {
    maxScore = mainMetricField.thresholds.green; // Use green threshold as max
  } else if (mainMetricField.type === 'number') {
    maxScore = 100; // Default assumption
  }

  return {
    overall_score: overallScore !== undefined 
      ? (typeof overallScore === 'object' ? JSON.stringify(overallScore) : overallScore) as string | number | boolean | null
      : null,
    max_score: maxScore,
    breakdown: Object.keys(breakdown).length > 0 ? breakdown : null,
    reasoning,
    metadata: {
      main_metric_key: mainMetricField.key,
      main_metric_type: mainMetricField.type,
      thresholds: mainMetricField.thresholds || null,
    },
  };
}

/**
 * Save an evaluator run to history
 */
export async function saveEvaluatorRun(
  evaluator: EvaluatorDefinition,
  listing: Listing,
  run: EvaluatorRun
): Promise<string> {
  const durationMs = run.completedAt && run.startedAt
    ? run.completedAt.getTime() - run.startedAt.getTime()
    : null;

  // Map EvaluatorRun status to HistoryStatus
  let historyStatus: HistoryEntry['status'];
  switch (run.status) {
    case 'completed':
      historyStatus = 'success';
      break;
    case 'failed':
      historyStatus = 'error';
      break;
    case 'pending':
    case 'processing':
      historyStatus = 'pending';
      break;
    default:
      historyStatus = 'error';
  }

  // Build input and output payloads
  const inputPayload = run.rawRequest || evaluator.prompt;  // Use raw request if available, fallback to template
  const outputPayload = run.rawResponse || run.output || null;  // Use raw response if available, fallback to parsed

  // Extract scores for backward compatibility
  const scores = extractScores(run.output, evaluator);

  // Build evaluator run data
  const data: EvaluatorRunData = {
    evaluator_name: evaluator.name,
    evaluator_type: 'llm_evaluator',
    config_snapshot: {
      model_id: evaluator.modelId,
      output_schema: evaluator.outputSchema,
      prompt: evaluator.prompt,
    },
    input_payload: inputPayload,
    output_payload: outputPayload,
    scores,
  };

  // Add error details if failed
  if (run.error) {
    data.error_details = {
      message: run.error,
      failed_at: run.completedAt?.toISOString(),
    };
  }

  // Map listing.appId to HistoryAppId
  const historyAppId: HistoryAppId = listing.appId === 'voice-rx' ? 'voicerx' : 'kaira';

  // Create history entry
  const historyEntry: Omit<HistoryEntry, 'id' | 'timestamp'> = {
    app_id: historyAppId,
    source_type: 'evaluator_run',
    entity_type: 'listing',
    entity_id: listing.id,
    source_id: evaluator.id, // Use evaluator ID as source_id
    status: historyStatus,
    duration_ms: durationMs,
    data,
    triggered_by: 'manual',
    schema_version: '1.0',
    user_context: null,
  };

  return historyRepository.save(historyEntry);
}
