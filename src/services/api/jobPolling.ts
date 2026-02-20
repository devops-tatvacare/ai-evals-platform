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

// ── Generic polling primitive ───────────────────────────────────

export interface PollConfig<T> {
  /** Called each iteration. Return `{ done: true, data }` to stop. */
  fn: () => Promise<{ done: boolean; data?: T }>;
  /** Milliseconds between iterations (default 5000). */
  intervalMs?: number;
  /** Abort signal — causes poll to throw AbortError. */
  signal?: AbortSignal;
  /** Optional dynamic backoff. Called before each sleep. Added to intervalMs. */
  getBackoffMs?: () => number;
  /** Stop after N iterations even if not done. */
  maxIterations?: number;
}

/**
 * Generic async polling loop.
 * - Pauses when the tab is hidden (zero wakeups).
 * - Supports AbortSignal for cancellation.
 */
export async function poll<T>(config: PollConfig<T>): Promise<T | undefined> {
  const { fn, intervalMs = 5000, signal, maxIterations } = config;
  let iteration = 0;

  while (true) {
    // Pause when tab is hidden
    if (typeof document !== 'undefined' && document.hidden) {
      // Check abort BEFORE setting up listeners
      if (signal?.aborted) {
        throw new DOMException('Polling aborted', 'AbortError');
      }

      await new Promise<void>((resolve) => {
        const onVisible = () => {
          if (!document.hidden) {
            document.removeEventListener('visibilitychange', onVisible);
            resolve();
          }
        };
        document.addEventListener('visibilitychange', onVisible);
        if (signal) {
          // Handle case where signal aborts while we're waiting
          if (signal.aborted) {
            document.removeEventListener('visibilitychange', onVisible);
            resolve();
            return;
          }
          signal.addEventListener('abort', () => {
            document.removeEventListener('visibilitychange', onVisible);
            resolve();
          }, { once: true });
        }
      });
    }

    if (signal?.aborted) {
      throw new DOMException('Polling aborted', 'AbortError');
    }

    const result = await fn();
    if (result.done) return result.data;

    iteration++;
    if (maxIterations != null && iteration >= maxIterations) return undefined;

    // Sleep with abort support
    const sleepMs = intervalMs + (config.getBackoffMs?.() ?? 0);
    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        if (onAbort && signal) signal.removeEventListener('abort', onAbort);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, sleepMs);
      if (signal) {
        onAbort = () => {
          clearTimeout(timer);
          cleanup();
          reject(new DOMException('Polling aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

// ── Job-specific types ──────────────────────────────────────────

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
  const { onProgress, onJobCreated, pollIntervalMs = 5000, signal } = options;

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
  const { onProgress, pollIntervalMs = 5000, signal } = options;

  try {
    const job = await poll<Job>({
      fn: async () => {
        const job = await fetchWithRetry(() => jobsApi.get(jobId));

        if (onProgress && job.progress) {
          onProgress({
            current: job.progress.current,
            total: job.progress.total,
            message: job.progress.message,
            listingId: (job.progress as Record<string, unknown>).listing_id as string | undefined,
            evaluatorId: (job.progress as Record<string, unknown>).evaluator_id as string | undefined,
          });
        }

        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          return { done: true, data: job };
        }

        return { done: false };
      },
      intervalMs: pollIntervalMs,
      signal,
    });

    return job!;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Cancel the backend job on abort
      try { await jobsApi.cancel(jobId); } catch { /* best-effort */ }
      throw new DOMException('Job polling aborted', 'AbortError');
    }
    throw err;
  }
}

/**
 * Cancel a running job on the backend.
 */
export async function cancelJob(jobId: string): Promise<void> {
  await jobsApi.cancel(jobId);
}
