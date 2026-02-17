import { submitAndPollJob } from '@/services/api/jobPolling';
import { fetchLatestRun } from '@/services/api/evalRunsApi';
import type {
  EvaluatorDefinition,
  EvalRun,
  Listing,
  KairaChatSession,
} from '@/types';

export interface ExecuteOptions {
  abortSignal?: AbortSignal;
}

/** Map raw error to user-friendly message. Shared by execute() and executeForSession(). */
function friendlyErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error occurred';

  const msg = error.message.toLowerCase();

  if (msg.includes('abort') || msg.includes('cancelled') || msg.includes('canceled')) {
    return 'Operation was cancelled.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'Network error: Unable to reach AI service. Please check your internet connection.';
  }
  if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthorized') || msg.includes('401')) {
    return 'Authentication failed: Invalid or missing API key.';
  }
  if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) {
    return 'Rate limit exceeded. Please try again later.';
  }
  if (msg.includes('timeout')) {
    return 'Request timed out. The model may be overloaded.';
  }
  return error.message;
}

/** Build a synthetic failed EvalRun (used before the backend has created a real row). */
function makeFailed(
  evaluatorId: string,
  appId: string,
  errorMsg: string,
  extra: { listingId?: string; sessionId?: string },
): EvalRun {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    appId,
    evalType: 'custom',
    evaluatorId,
    listingId: extra.listingId,
    sessionId: extra.sessionId,
    status: 'failed',
    errorMessage: errorMsg,
    config: {},
    createdAt: now,
    startedAt: now,
    completedAt: now,
  };
}

export class EvaluatorExecutor {
  async execute(
    evaluator: EvaluatorDefinition,
    listing: Listing,
    options?: ExecuteOptions
  ): Promise<EvalRun> {
    const appId = listing.appId || 'voice-rx';

    try {
      // Check if already aborted
      if (options?.abortSignal?.aborted) {
        throw new DOMException('Operation was cancelled', 'AbortError');
      }

      // Submit backend job
      const jobParams: Record<string, unknown> = {
        evaluator_id: evaluator.id,
        listing_id: listing.id,
        app_id: appId,
      };

      const completedJob = await submitAndPollJob(
        'evaluate-custom',
        jobParams,
        {
          signal: options?.abortSignal,
          pollIntervalMs: 2000,
        },
      );

      if (completedJob.status === 'failed') {
        throw new Error(completedJob.errorMessage || 'Evaluator execution failed');
      }

      if (completedJob.status === 'cancelled') {
        return makeFailed(evaluator.id, appId, 'Cancelled', { listingId: listing.id });
      }

      // Fetch the latest eval run from the eval_runs table
      const latestRun = await fetchLatestRun({
        evaluator_id: evaluator.id,
        listing_id: listing.id,
      });

      if (latestRun) {
        return latestRun;
      }

      // Fallback: build a completed run from job result
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID(),
        appId,
        evalType: 'custom',
        evaluatorId: evaluator.id,
        listingId: listing.id,
        status: 'completed',
        config: {},
        result: (completedJob.result && Object.keys(completedJob.result).length > 0)
          ? completedJob.result : undefined,
        createdAt: now,
        startedAt: now,
        completedAt: now,
      };

    } catch (error) {
      // Check if this was a cancellation
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      const msg = isAborted ? 'Cancelled' : friendlyErrorMessage(error);
      return makeFailed(evaluator.id, appId, msg, { listingId: listing.id });
    }
  }

  async executeForSession(
    evaluator: EvaluatorDefinition,
    session: KairaChatSession,
    options?: ExecuteOptions
  ): Promise<EvalRun> {
    const appId = 'kaira-bot';

    try {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('Operation was cancelled', 'AbortError');
      }

      const jobParams: Record<string, unknown> = {
        evaluator_id: evaluator.id,
        session_id: session.id,
        app_id: appId,
      };

      const completedJob = await submitAndPollJob(
        'evaluate-custom',
        jobParams,
        {
          signal: options?.abortSignal,
          pollIntervalMs: 2000,
        },
      );

      if (completedJob.status === 'failed') {
        throw new Error(completedJob.errorMessage || 'Evaluator execution failed');
      }

      if (completedJob.status === 'cancelled') {
        return makeFailed(evaluator.id, appId, 'Cancelled', { sessionId: session.id });
      }

      // Fetch the latest eval run from the eval_runs table
      const latestRun = await fetchLatestRun({
        evaluator_id: evaluator.id,
        session_id: session.id,
      });

      if (latestRun) {
        return latestRun;
      }

      // Fallback: build a completed run from job result
      const now = new Date().toISOString();
      return {
        id: crypto.randomUUID(),
        appId,
        evalType: 'custom',
        evaluatorId: evaluator.id,
        sessionId: session.id,
        status: 'completed',
        config: {},
        result: (completedJob.result && Object.keys(completedJob.result).length > 0)
          ? completedJob.result : undefined,
        createdAt: now,
        startedAt: now,
        completedAt: now,
      };

    } catch (error) {
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      const msg = isAborted ? 'Cancelled' : friendlyErrorMessage(error);
      return makeFailed(evaluator.id, appId, msg, { sessionId: session.id });
    }
  }
}

export const evaluatorExecutor = new EvaluatorExecutor();
