/**
 * Job Polling Utility
 * Wraps jobsApi with abort signal support and typed progress callbacks.
 */
import { jobsApi, type Job } from './jobsApi';
import { ApiError } from './client';

// ── Retry logic for transient errors ────────────────────────────

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error instanceof ApiError && error.status >= 500) return true;
  if (error instanceof ApiError && error.status === 408) return true;
  if (error instanceof ApiError && error.status === 429) return true;
  return false;
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && isTransientError(err)) {
        await new Promise(r => setTimeout(r, baseDelayMs * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError; // unreachable, satisfies TS
}

export interface JobProgress {
  current: number;
  total: number;
  message: string;
  listingId?: string;
  evaluatorId?: string;
}

export interface PollOptions {
  onProgress?: (progress: JobProgress) => void;
  /** Called immediately after job is submitted (before polling starts) */
  onJobCreated?: (jobId: string) => void;
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
  const { onProgress, onJobCreated, pollIntervalMs = 2000, signal } = options;

  // Submit the job (with retry for transient errors)
  const job = await fetchWithRetry(() => jobsApi.submit(jobType, params));

  // Notify caller of job ID immediately (before polling starts)
  onJobCreated?.(job.id);

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

    const job = await fetchWithRetry(() => jobsApi.get(jobId));

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

    // Wait before next poll (with proper abort listener cleanup)
    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, pollIntervalMs);

      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          cleanup();
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
