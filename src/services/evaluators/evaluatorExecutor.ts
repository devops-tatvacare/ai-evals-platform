import { submitAndPollJob } from '@/services/api/jobPolling';
import { listingsRepository } from '@/services/storage';
import { chatSessionsRepository } from '@/services/api/chatApi';
import { useAppStore } from '@/stores';
import type {
  EvaluatorDefinition,
  EvaluatorRun,
  Listing,
  KairaChatSession,
  AppId,
} from '@/types';

export interface ExecuteOptions {
  abortSignal?: AbortSignal;
}

export class EvaluatorExecutor {
  async execute(
    evaluator: EvaluatorDefinition,
    listing: Listing,
    options?: ExecuteOptions
  ): Promise<EvaluatorRun> {
    const run: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      listingId: listing.id,
      status: 'processing',
      startedAt: new Date(),
    };

    try {
      // Check if already aborted
      if (options?.abortSignal?.aborted) {
        throw new DOMException('Operation was cancelled', 'AbortError');
      }

      // Submit backend job
      const jobParams: Record<string, unknown> = {
        evaluator_id: evaluator.id,
        listing_id: listing.id,
        app_id: listing.appId || 'voice-rx',
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
        return {
          ...run,
          status: 'failed' as const,
          error: 'Cancelled',
          completedAt: new Date(),
        };
      }

      // Fetch updated listing to get the latest evaluator_runs
      const appId = useAppStore.getState().currentApp;
      const updatedListing = await listingsRepository.getById(appId, listing.id);
      const evaluatorRuns = updatedListing?.evaluatorRuns ?? [];

      // Find the latest run for this evaluator
      const latestRun = [...evaluatorRuns]
        .reverse()
        .find((r: EvaluatorRun) => r.evaluatorId === evaluator.id);

      if (latestRun) {
        return latestRun;
      }

      // Fallback: return a completed run based on job result
      return {
        ...run,
        status: 'completed' as const,
        output: completedJob.result ?? undefined,
        completedAt: new Date(),
      };

    } catch (error) {
      // Check if this was a cancellation
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      if (isAborted) {
        return {
          ...run,
          status: 'failed' as const,
          error: 'Cancelled',
          completedAt: new Date(),
        };
      }

      // Provide user-friendly error messages
      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        const msg = error.message.toLowerCase();

        if (msg.includes('abort') || msg.includes('cancelled') || msg.includes('canceled')) {
          errorMessage = 'Operation was cancelled.';
        } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
          errorMessage = 'Network error: Unable to reach AI service. Please check your internet connection.';
        } else if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthorized') || msg.includes('401')) {
          errorMessage = 'Authentication failed: Invalid or missing API key.';
        } else if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (msg.includes('timeout')) {
          errorMessage = 'Request timed out. The model may be overloaded.';
        } else {
          errorMessage = error.message;
        }
      }

      return {
        ...run,
        status: 'failed' as const,
        error: errorMessage,
        completedAt: new Date(),
      };
    }
  }

  async executeForSession(
    evaluator: EvaluatorDefinition,
    session: KairaChatSession,
    options?: ExecuteOptions
  ): Promise<EvaluatorRun> {
    const run: EvaluatorRun = {
      id: crypto.randomUUID(),
      evaluatorId: evaluator.id,
      sessionId: session.id,
      status: 'processing',
      startedAt: new Date(),
    };

    try {
      if (options?.abortSignal?.aborted) {
        throw new DOMException('Operation was cancelled', 'AbortError');
      }

      const jobParams: Record<string, unknown> = {
        evaluator_id: evaluator.id,
        session_id: session.id,
        app_id: 'kaira-bot',
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
        return {
          ...run,
          status: 'failed' as const,
          error: 'Cancelled',
          completedAt: new Date(),
        };
      }

      // Fetch updated session to get the latest evaluator_runs
      const updatedSession = await chatSessionsRepository.getById('kaira-bot' as AppId, session.id);
      const evaluatorRuns = updatedSession?.evaluatorRuns ?? [];

      const latestRun = [...evaluatorRuns]
        .reverse()
        .find((r: EvaluatorRun) => r.evaluatorId === evaluator.id);

      if (latestRun) {
        return latestRun;
      }

      return {
        ...run,
        status: 'completed' as const,
        output: completedJob.result ?? undefined,
        completedAt: new Date(),
      };

    } catch (error) {
      const isAborted = error instanceof DOMException && error.name === 'AbortError';
      if (isAborted) {
        return { ...run, status: 'failed' as const, error: 'Cancelled', completedAt: new Date() };
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return { ...run, status: 'failed' as const, error: errorMessage, completedAt: new Date() };
    }
  }
}

export const evaluatorExecutor = new EvaluatorExecutor();
