import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { usePoll } from '@/hooks';
import { logger } from '@/services/logger';

export type RunDetailPhase = 'loading' | 'ready' | 'error' | 'notFound';

export interface UseRunDetailStateInput<TRun> {
  runId: string | undefined;
  /** Fetch the run row. Thrown errors surface as `phase === 'error'` unless
   *  `isNotFound` catches them. */
  fetchRun: (runId: string) => Promise<TRun>;
  /** Drives the auto-poll loop. The hook re-fetches on `pollIntervalMs`
   *  while this returns true. */
  isActive: (run: TRun) => boolean;
  /** Cadence for the auto-poll. Defaults to 5000ms. */
  pollIntervalMs?: number;
  /** Disable the run-level auto-poll. Entries that own their own poll loop
   *  (e.g. job-progress drivers) keep the hook for initial-fetch state mgmt
   *  only. Defaults to true. */
  pollWhileActive?: boolean;
  /** Side-effect run after each successful run fetch (initial + every poll
   *  tick). Use for dependent rows (threads, adversarial, active job).
   *  Errors here don't tip the surface into `phase === 'error'` — they're
   *  logged and the run state stays ready. */
  onRunFetched?: (run: TRun) => Promise<void> | void;
  /** Map a fetch error to the `notFound` phase (e.g. ApiError with status
   *  404). When omitted, every error becomes `phase === 'error'`. */
  isNotFound?: (e: unknown) => boolean;
}

export interface UseRunDetailStateOutput<TRun> {
  run: TRun | null;
  phase: RunDetailPhase;
  error: string | null;
  /** Re-fetch the run on demand. Resolves after `onRunFetched` settles. */
  refetch: () => Promise<void>;
  /** Optimistic local update — the next refetch overwrites. Use sparingly
   *  for visibility patches and cancel-flow status fixups. */
  setRun: Dispatch<SetStateAction<TRun | null>>;
}

/**
 * Owns the run-detail surface's run state: initial fetch, polling while the
 * run is active, and the loading / ready / error / notFound phase machine.
 *
 * Callers pass inline callbacks freely — the hook stabilises them via refs
 * so re-renders don't restart the loop.
 */
export function useRunDetailState<TRun>({
  runId,
  fetchRun,
  isActive,
  pollIntervalMs = 5000,
  pollWhileActive = true,
  onRunFetched,
  isNotFound,
}: UseRunDetailStateInput<TRun>): UseRunDetailStateOutput<TRun> {
  const [run, setRun] = useState<TRun | null>(null);
  const [phase, setPhase] = useState<RunDetailPhase>('loading');
  const [error, setError] = useState<string | null>(null);

  // Stabilise callback identity so inline lambdas don't reset the loop.
  const fetchRunRef = useRef(fetchRun);
  const onRunFetchedRef = useRef(onRunFetched);
  const isNotFoundRef = useRef(isNotFound);
  useEffect(() => {
    fetchRunRef.current = fetchRun;
    onRunFetchedRef.current = onRunFetched;
    isNotFoundRef.current = isNotFound;
  });

  const refetch = useCallback(async () => {
    if (!runId) return;
    try {
      const next = await fetchRunRef.current(runId);
      setRun(next);
      setError(null);
      setPhase('ready');
      const cb = onRunFetchedRef.current;
      if (cb) {
        try {
          await cb(next);
        } catch (cbErr) {
          // Dependent-row failures don't take the surface down — the run
          // state is still good. Surface the diagnostic so it's visible.
          logger.warn('useRunDetailState: onRunFetched callback failed', {
            error: cbErr instanceof Error ? cbErr.message : String(cbErr),
          });
        }
      }
    } catch (e) {
      if (isNotFoundRef.current?.(e)) {
        setPhase('notFound');
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to load run');
      setPhase('error');
    }
  }, [runId]);

  // Initial fetch + reset on runId change. The state resets are intentional —
  // a fresh runId must surface as `loading` before the new fetch resolves,
  // not as the previous run's `ready`.
  useEffect(() => {
    if (!runId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('loading');
    setRun(null);
    setError(null);
    void refetch();
  }, [runId, refetch]);

  // Auto-poll while active. Internal usePoll already refs its callback.
  // Call `isActive` directly here — derived flags are fine to depend on
  // the latest props, and reading the ref during render trips the linter.
  const pollEnabled = pollWhileActive && !!run && isActive(run);
  usePoll({
    fn: async () => {
      await refetch();
      return true;
    },
    enabled: pollEnabled,
    intervalMs: pollIntervalMs,
  });

  return { run, phase, error, refetch, setRun };
}
