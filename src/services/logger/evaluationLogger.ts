/**
 * Evaluation Logger
 * Specialized logging for the two-call evaluation flow
 */

import { logger } from './logger';

const EVAL_CONTEXT = { component: 'EvaluationService' };

/**
 * Log evaluation start with prompts used
 */
export function logEvaluationStart(
  listingId: string,
  prompts: { transcription: string; evaluation: string }
): void {
  logger.info('Evaluation started', {
    ...EVAL_CONTEXT,
    listingId,
    transcriptionPromptLength: prompts.transcription.length,
    evaluationPromptLength: prompts.evaluation.length,
  });
}

/**
 * Log Call 1 (transcription) skipped - using existing AI transcript
 */
export function logCall1Skipped(
  listingId: string,
  existingTranscript: {
    existingTranscriptSegments: number;
    existingModel: string;
    existingCreatedAt?: Date;
  }
): void {
  logger.info('Call 1/2: Transcription skipped (reusing existing)', {
    ...EVAL_CONTEXT,
    callNumber: 1,
    stage: 'transcribing',
    skipped: true,
    listingId,
    ...existingTranscript,
  });
}

/**
 * Log normalization started
 */
export function logNormalizationStart(
  listingId: string,
  sourceScript: string,
  targetScript: string
): void {
  logger.info('Normalization: Started', {
    ...EVAL_CONTEXT,
    stage: 'normalizing',
    listingId,
    sourceScript,
    targetScript,
  });
}

/**
 * Log normalization completed
 */
export function logNormalizationComplete(
  listingId: string,
  segmentCount: number
): void {
  logger.info('Normalization: Completed', {
    ...EVAL_CONTEXT,
    stage: 'normalizing',
    listingId,
    segmentCount,
  });
}

/**
 * Log normalization skipped
 */
export function logNormalizationSkipped(
  listingId: string,
  reason: string
): void {
  logger.info('Normalization: Skipped', {
    ...EVAL_CONTEXT,
    stage: 'normalizing',
    listingId,
    reason,
  });
}

/**
 * Log Call 1 (transcription) start
 */
export function logCall1Start(listingId?: string): void {
  logger.info('Call 1/2: Transcription started', {
    ...EVAL_CONTEXT,
    callNumber: 1,
    stage: 'transcribing',
    listingId,
  });
}

/**
 * Log Call 1 (transcription) completion
 */
export function logCall1Complete(segmentCount: number, listingId?: string): void {
  logger.info('Call 1/2: Transcription completed', {
    ...EVAL_CONTEXT,
    callNumber: 1,
    stage: 'transcribing',
    segmentCount,
    listingId,
  });
}

/**
 * Log Call 1 (transcription) failure
 */
export function logCall1Failed(error: string, listingId?: string): void {
  logger.error('Call 1/2: Transcription failed', {
    ...EVAL_CONTEXT,
    callNumber: 1,
    stage: 'transcribing',
    error,
    listingId,
  });
}

/**
 * Log Call 2 (critique) start
 */
export function logCall2Start(listingId?: string): void {
  logger.info('Call 2/2: Critique started', {
    ...EVAL_CONTEXT,
    callNumber: 2,
    stage: 'critiquing',
    listingId,
  });
}

/**
 * Log Call 2 (critique) completion
 */
export function logCall2Complete(critiqueCount: number, listingId?: string): void {
  logger.info('Call 2/2: Critique completed', {
    ...EVAL_CONTEXT,
    callNumber: 2,
    stage: 'critiquing',
    critiqueCount,
    listingId,
  });
}

/**
 * Log Call 2 (critique) failure
 */
export function logCall2Failed(error: string, listingId?: string): void {
  logger.error('Call 2/2: Critique failed', {
    ...EVAL_CONTEXT,
    callNumber: 2,
    stage: 'critiquing',
    error,
    listingId,
  });
}

/**
 * Log metrics computation
 */
export function logMetricsComputed(
  listingId: string,
  metrics: { wer?: number; cer?: number; matchPercentage?: number; alignmentStats?: string }
): void {
  logger.info('Evaluation metrics computed', {
    ...EVAL_CONTEXT,
    listingId,
    ...metrics,
  });
}

/**
 * Log segment alignment
 */
export function logAlignmentComplete(
  listingId: string,
  stats: {
    originalSegments: number;
    llmSegments: number;
    alignedPairs: number;
    mode: string;
  }
): void {
  logger.info('Segment alignment complete', {
    ...EVAL_CONTEXT,
    listingId,
    ...stats,
  });
}

/**
 * Log full evaluation completion
 */
export function logEvaluationComplete(
  listingId: string,
  result: {
    segmentCount: number;
    critiqueCount: number;
    wer?: number;
    cer?: number;
    alignedPairs?: number;
    skippedTranscription?: boolean;
  }
): void {
  logger.info('Evaluation complete', {
    ...EVAL_CONTEXT,
    listingId,
    ...result,
  });
}

/**
 * Log evaluation failure
 */
export function logEvaluationFailed(
  listingId: string,
  failedAt: 'transcription' | 'critique' | 'metrics',
  error: string
): void {
  logger.error('Evaluation failed', {
    ...EVAL_CONTEXT,
    listingId,
    failedAt,
    error,
  });
}

// ============================================================
// Source Type & Flow Selection Logging (Phase 7 additions)
// ============================================================

const UPLOAD_CONTEXT = { component: 'UploadService' };

/**
 * Log source type assignment (when "Fetch from API" or "Add Transcripts" clicked)
 */
export function logSourceTypeAssigned(
  listingId: string,
  sourceType: 'api' | 'upload',
  trigger: 'fetch_api' | 'add_transcript'
): void {
  logger.info(`Source type assigned: ${sourceType}`, {
    ...UPLOAD_CONTEXT,
    listingId,
    sourceType,
    trigger,
  });
}

/**
 * Log transcript segment detection results
 */
export function logTranscriptSegmentDetection(
  listingId: string,
  detection: {
    hasTimeSegments: boolean;
    segmentCount: number;
    speakerCount: number;
    format: 'json' | 'txt';
  }
): void {
  logger.info('Transcript segment detection complete', {
    ...UPLOAD_CONTEXT,
    listingId,
    hasTimeSegments: detection.hasTimeSegments,
    segmentCount: detection.segmentCount,
    speakerCount: detection.speakerCount,
    format: detection.format,
  });
}

/**
 * Log API fetch success
 */
export function logApiFetchSuccess(
  listingId: string,
  details: {
    hasTranscript: boolean;
    hasStructuredOutput: boolean;
    inputLength?: number;
  }
): void {
  logger.info('API fetch successful', {
    ...UPLOAD_CONTEXT,
    listingId,
    ...details,
  });
}

/**
 * Log API fetch failure
 */
export function logApiFetchFailed(
  listingId: string,
  error: string
): void {
  logger.error('API fetch failed', {
    ...UPLOAD_CONTEXT,
    listingId,
    error,
  });
}

/**
 * Log evaluation flow selection (segment vs API flow)
 */
export function logEvaluationFlowSelected(
  listingId: string,
  flow: 'segment' | 'api',
  reason: {
    sourceType?: string;
    hasTimeSegments?: boolean;
    hasApiResponse?: boolean;
  }
): void {
  logger.info(`Evaluation flow selected: ${flow}`, {
    ...EVAL_CONTEXT,
    listingId,
    flow,
    ...reason,
  });
}

/**
 * Log listing creation (audio only upload)
 */
export function logListingCreated(
  listingId: string,
  details: {
    audioFileName: string;
    audioSize: number;
    audioFormat: string;
  }
): void {
  logger.info('Listing created', {
    ...UPLOAD_CONTEXT,
    listingId,
    ...details,
  });
}
