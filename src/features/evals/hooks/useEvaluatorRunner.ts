/**
 * useEvaluatorRunner — shared orchestration for running evaluators.
 *
 * Extracts the handleRun / handleCancel / getLatestRun logic that was
 * duplicated between EvaluatorsView (voice-rx) and KairaBotEvaluatorsView.
 *
 * Each consumer provides an `EvaluatorTarget` that wires entity-specific
 * executor methods; the hook handles:
 *   - Local evaluatorRuns state (fetched from eval_runs API) + abort controllers
 *   - Concurrent run prevention
 *   - API key check
 *   - Running placeholder → execute → API-is-truth reload
 *   - Task queue + notifications
 *   - Fallback on reload failure
 *   - Cleanup on unmount
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLLMSettingsStore, useTaskQueueStore, hasLLMCredentials } from '@/stores';
import { notificationService } from '@/services/notifications';
import { fetchEvalRuns } from '@/services/api/evalRunsApi';
import type { EvaluatorDefinition, EvalRun } from '@/types';

export interface EvaluatorTarget {
  /** listing ID (voice-rx) or session ID (kaira-bot) */
  entityId: string;
  appId: string;
  /** Optional: listing ID for voice-rx queries */
  listingId?: string;
  /** Optional: session ID for kaira-bot queries */
  sessionId?: string;
  execute: (evaluator: EvaluatorDefinition, signal: AbortSignal) => Promise<void>;
}

export interface UseEvaluatorRunnerReturn {
  evaluatorRuns: EvalRun[];
  syncRuns: () => Promise<void>;
  handleRun: (evaluator: EvaluatorDefinition) => Promise<void>;
  handleCancel: (evaluatorId: string) => void;
  getLatestRun: (evaluatorId: string) => EvalRun | undefined;
}

/** Build a local placeholder EvalRun while the backend job is in flight. */
function makeRunningPlaceholder(
  evaluatorId: string,
  appId: string,
  extra: { listingId?: string; sessionId?: string },
): EvalRun {
  const now = new Date().toISOString();
  return {
    id: `local-${crypto.randomUUID()}`,
    appId,
    evalType: 'custom',
    evaluatorId,
    listingId: extra.listingId,
    sessionId: extra.sessionId,
    status: 'running',
    config: {},
    createdAt: now,
    startedAt: now,
  };
}

export function useEvaluatorRunner(target: EvaluatorTarget): UseEvaluatorRunnerReturn {
  const [evaluatorRuns, setEvaluatorRuns] = useState<EvalRun[]>([]);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Keep target in a ref so handleRun always sees the latest without
  // being re-created on every render (target object is new each render).
  const targetRef = useRef(target);
  targetRef.current = target;

  // Cleanup all abort controllers on unmount
  useEffect(() => {
    return () => {
      for (const controller of abortControllersRef.current.values()) {
        controller.abort();
      }
      abortControllersRef.current.clear();
    };
  }, []);

  /** Fetch eval runs from the API and update local state. */
  const syncRuns = useCallback(async () => {
    const t = targetRef.current;
    // Determine the query params based on what IDs are available
    const listingId = t.listingId || (t.appId !== 'kaira-bot' ? t.entityId : undefined);
    const sessionId = t.sessionId || (t.appId === 'kaira-bot' ? t.entityId : undefined);

    if (!listingId && !sessionId) return;

    try {
      const runs = await fetchEvalRuns({
        listing_id: listingId,
        session_id: sessionId,
        eval_type: 'custom',
      });
      setEvaluatorRuns(runs);
    } catch {
      // Silently fail — keep whatever we had
    }
  }, []);

  // Initial sync when entity changes
  useEffect(() => {
    if (target.entityId) {
      syncRuns();
    }
  }, [target.entityId, syncRuns]);

  const handleRun = useCallback(async (evaluator: EvaluatorDefinition) => {
    const t = targetRef.current;

    // Prevent concurrent runs of the same evaluator
    if (abortControllersRef.current.has(evaluator.id)) {
      notificationService.info(`${evaluator.name} is already running`, 'Already Running');
      return;
    }

    // Check credentials (API key or service account)
    const llm = useLLMSettingsStore.getState();
    if (!hasLLMCredentials(llm)) {
      notificationService.error('Please configure your API key or service account in Settings', 'Credentials Required');
      return;
    }

    // Register abort controller IMMEDIATELY (before any awaits) to close
    // the race window where a second click could slip through.
    const abortController = new AbortController();
    abortControllersRef.current.set(evaluator.id, abortController);

    // Determine listing/session IDs
    const listingId = t.listingId || (t.appId !== 'kaira-bot' ? t.entityId : undefined);
    const sessionId = t.sessionId || (t.appId === 'kaira-bot' ? t.entityId : undefined);

    // Create running placeholder
    const processingRun = makeRunningPlaceholder(evaluator.id, t.appId, { listingId, sessionId });

    // Update local state immediately for UI feedback
    setEvaluatorRuns(prev => {
      const updated = [...prev];
      const idx = updated.findIndex(r => r.evaluatorId === evaluator.id);
      if (idx >= 0) updated[idx] = processingRun;
      else updated.push(processingRun);
      return updated;
    });

    // Task queue + notification
    const { addTask, completeTask } = useTaskQueueStore.getState();
    const taskId = addTask({ type: 'evaluator', listingId: t.entityId });
    notificationService.info(`Running ${evaluator.name}...`, 'Evaluator Started');

    try {
      // Execute — ignore return value, backend is source of truth
      await t.execute(evaluator, abortController.signal);
    } catch {
      // Errors from polling/abort — backend may or may not have saved.
      // Fall through to reload below.
    } finally {
      abortControllersRef.current.delete(evaluator.id);
    }

    // Backend is source of truth — reload from eval_runs API
    try {
      const freshRuns = await fetchEvalRuns({
        listing_id: listingId,
        session_id: sessionId,
        eval_type: 'custom',
      });
      setEvaluatorRuns(freshRuns);

      const latestRun = freshRuns.find((r: EvalRun) => r.evaluatorId === evaluator.id);
      const succeeded = latestRun?.status === 'completed';

      completeTask(taskId, succeeded ? 'success' : 'error');

      if (succeeded) {
        notificationService.success(`${evaluator.name} completed successfully`, 'Evaluator Complete');
      } else {
        notificationService.error(latestRun?.errorMessage || 'Evaluator failed', `${evaluator.name} Failed`);
      }
    } catch {
      // Reload failed — set local failed state so card doesn't stay stuck
      setEvaluatorRuns(prev => {
        const fallback = [...prev];
        const idx = fallback.findIndex(r => r.evaluatorId === evaluator.id);
        const failedRun: EvalRun = {
          ...processingRun,
          status: 'failed',
          errorMessage: 'Failed to retrieve results',
          completedAt: new Date().toISOString(),
        };
        if (idx >= 0) fallback[idx] = failedRun;
        else fallback.push(failedRun);
        return fallback;
      });

      completeTask(taskId, 'error');
      notificationService.error('Failed to retrieve evaluator results', `${evaluator.name} Failed`);
    }
  }, []); // No deps — reads target from ref

  const handleCancel = useCallback((evaluatorId: string) => {
    const controller = abortControllersRef.current.get(evaluatorId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(evaluatorId);
      notificationService.info('Evaluator cancelled');
    }
  }, []);

  const getLatestRun = useCallback((evaluatorId: string): EvalRun | undefined => {
    const matching = evaluatorRuns.filter(r => r.evaluatorId === evaluatorId);
    // Prefer non-running entries (handles stale states)
    const best = matching.find(r => r.status !== 'running') || matching[0];

    // Guard: if a run is stuck in 'running' for >10 minutes and no abort
    // controller is active for it, treat it as failed (stale from crash/tab close)
    if (best?.status === 'running' && !abortControllersRef.current.has(evaluatorId)) {
      const startedAt = best.startedAt ? new Date(best.startedAt) : new Date(best.createdAt);
      const staleMs = Date.now() - startedAt.getTime();
      if (staleMs > 10 * 60 * 1000) {
        return { ...best, status: 'failed', errorMessage: 'Stale: run did not complete' };
      }
    }

    return best;
  }, [evaluatorRuns]);

  return { evaluatorRuns, syncRuns, handleRun, handleCancel, getLatestRun };
}
