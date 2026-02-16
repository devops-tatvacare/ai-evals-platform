/**
 * Job Polling Utility
 * Wraps jobsApi with abort signal support and typed progress callbacks.
 */
import { jobsApi, type Job } from './jobsApi';

export interface JobProgress {
  current: number;
  total: number;
  message: string;
  listingId?: string;
  evaluatorId?: string;
}

export interface PollOptions {
  onProgress?: (progress: JobProgress) => void;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Submit a job and poll until it reaches a terminal state.
 * Supports cooperative cancellation via AbortSignal.
 */
export async function submitAndPollJob(
  jobType: string,
  params: Record<string, unknown>,
  options: PollOptions = {},
): Promise<Job> {
  const { onProgress, pollIntervalMs = 2000, signal } = options;

  // Submit the job
  const job = await jobsApi.submit(jobType, params);

  // Poll until done
  return pollJobUntilComplete(job.id, { onProgress, pollIntervalMs, signal });
}

/**
 * Poll an existing job until it reaches a terminal state.
 */
export async function pollJobUntilComplete(
  jobId: string,
  options: PollOptions = {},
): Promise<Job> {
  const { onProgress, pollIntervalMs = 2000, signal } = options;

  while (true) {
    // Check if cancelled
    if (signal?.aborted) {
      // Cancel the job on the backend too
      try {
        await jobsApi.cancel(jobId);
      } catch {
        // Best-effort cancel
      }
      throw new DOMException('Job polling aborted', 'AbortError');
    }

    const job = await jobsApi.get(jobId);

    // Extract progress and call handler
    if (onProgress && job.progress) {
      onProgress({
        current: job.progress.current,
        total: job.progress.total,
        message: job.progress.message,
        listingId: (job.progress as Record<string, unknown>).listing_id as string | undefined,
        evaluatorId: (job.progress as Record<string, unknown>).evaluator_id as string | undefined,
      });
    }

    // Check terminal states
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }

    // Wait before next poll
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Job polling aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

/**
 * Cancel a running job on the backend.
 */
export async function cancelJob(jobId: string): Promise<void> {
  await jobsApi.cancel(jobId);
}
