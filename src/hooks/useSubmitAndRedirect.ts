/**
 * useSubmitAndRedirect — DRY extraction of the submit-poll-redirect pattern
 * used by NewBatchEvalOverlay and NewAdversarialOverlay.
 *
 * Submits a job, registers it in the global job tracker, polls briefly for a
 * run_id, then redirects to the run detail page (or fallback).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useJobTrackerStore } from '@/stores';
import { runDetailForApp } from '@/config/routes';
import { poll } from '@/services/api/jobPolling';

interface SubmitAndRedirectOptions {
  appId: string;
  label: string;
  successMessage: string;
  fallbackRoute: string;
  onClose: () => void;
}

export function useSubmitAndRedirect(options: SubmitAndRedirectOptions) {
  const { appId, label, successMessage, fallbackRoute, onClose } = options;
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  // Abort on unmount
  useEffect(() => {
    return () => { controllerRef.current?.abort(); };
  }, []);

  const submit = useCallback(
    async (jobType: string, params: Record<string, unknown>) => {
      // Abort any previous in-flight submit
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setIsSubmitting(true);
      try {
        const job = await jobsApi.submit(jobType, params);

        // Register in global tracker
        useJobTrackerStore.getState().trackJob({
          jobId: job.id,
          appId,
          jobType,
          label,
          trackedAt: Date.now(),
        });

        notificationService.success(successMessage);

        // Poll briefly for run_id (up to 10s, every 2s)
        let runId: string | undefined;
        try {
          await poll<string>({
            fn: async () => {
              const updated = await jobsApi.get(job.id);
              const rid = (updated.progress as Record<string, unknown>)
                ?.run_id as string | undefined;
              if (rid) {
                runId = rid;
                return { done: true, data: rid };
              }
              if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
                return { done: true };
              }
              return { done: false };
            },
            intervalMs: 2000,
            signal: controller.signal,
            // 5 iterations * 2s = 10s max
            maxIterations: 5,
          });
        } catch {
          // AbortError or network error — fall through to redirect
        }

        // Don't navigate if aborted (component unmounted)
        if (controller.signal.aborted) return;

        if (runId) {
          useJobTrackerStore.getState().resolveRunId(job.id, runId);
          navigate(runDetailForApp(appId, runId));
        } else {
          navigate(fallbackRoute);
        }

        onClose();
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to submit job.';
        notificationService.error(msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [appId, label, successMessage, fallbackRoute, onClose, navigate],
  );

  return { submit, isSubmitting };
}
