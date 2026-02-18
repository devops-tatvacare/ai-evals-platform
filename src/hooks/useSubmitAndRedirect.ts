/**
 * useSubmitAndRedirect — DRY extraction of the submit-poll-redirect pattern
 * used by NewBatchEvalOverlay and NewAdversarialOverlay.
 *
 * Submits a job, registers it in the global job tracker, polls briefly for a
 * run_id, then redirects to the run detail page (or fallback).
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { useJobTrackerStore } from '@/stores';
import { routes } from '@/config/routes';

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

  const submit = useCallback(
    async (jobType: string, params: Record<string, unknown>) => {
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
        let redirected = false;
        const timeout = Date.now() + 10000;
        while (Date.now() < timeout) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const updated = await jobsApi.get(job.id);
            const runId = (updated.progress as Record<string, unknown>)
              ?.run_id as string | undefined;
            if (runId) {
              useJobTrackerStore.getState().resolveRunId(job.id, runId);
              navigate(routes.kaira.runDetail(runId));
              redirected = true;
              break;
            }
            if (['completed', 'failed', 'cancelled'].includes(updated.status))
              break;
          } catch {
            break;
          }
        }

        if (!redirected) {
          navigate(fallbackRoute);
        }

        onClose();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to submit job.';
        notificationService.error(msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [appId, label, successMessage, fallbackRoute, onClose, navigate],
  );

  return { submit, isSubmitting };
}
