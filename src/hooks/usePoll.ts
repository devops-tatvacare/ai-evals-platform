import { useEffect, useRef } from 'react';
import { poll } from '@/services/api/jobPolling';

export interface UsePollOptions {
  /** Async callback. Return `true` to keep polling, `false` to stop. */
  fn: () => Promise<boolean>;
  /** Whether polling is active. */
  enabled: boolean;
  /** Milliseconds between iterations (default 5000). */
  intervalMs?: number;
}

/**
 * React hook wrapping `poll()`.
 * Automatically pauses when hidden, aborts on unmount or when `enabled` becomes false.
 * Uses a ref for `fn` to avoid restarting the loop when the callback changes.
 */
export function usePoll({ fn, enabled, intervalMs = 5000 }: UsePollOptions): void {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let consecutiveErrors = 0;

    poll<void>({
      fn: async () => {
        try {
          const keepGoing = await fnRef.current();
          consecutiveErrors = 0;
          return { done: !keepGoing };
        } catch {
          consecutiveErrors++;
          return { done: false };
        }
      },
      intervalMs,
      getBackoffMs: () => {
        if (consecutiveErrors <= 1) return 0;
        // Exponential: 5s, 10s, 20s, 40s, capped at 60s
        return Math.min(intervalMs * 2 ** (consecutiveErrors - 1), 60000);
      },
      signal: controller.signal,
    }).catch(() => {
      // AbortError on unmount — expected
    });

    return () => controller.abort();
  }, [enabled, intervalMs]);
}
