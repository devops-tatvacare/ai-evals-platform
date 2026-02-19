/**
 * JobCompletionWatcher — headless component (renders null).
 *
 * Mounted once at app level inside the router context.
 * Polls tracked jobs from useJobTrackerStore and fires global
 * toasts on completion/failure, suppressing if the user is already
 * viewing the run detail page for that run.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobTrackerStore } from '@/stores';
import { jobsApi } from '@/services/api/jobsApi';
import { notificationService } from '@/services/notifications';
import { isRunDetailPath, runDetailForApp } from '@/config/routes';

const POLL_INTERVAL_MS = 3000;

export function JobCompletionWatcher() {
  const activeJobs = useJobTrackerStore((s) => s.activeJobs);
  const navigate = useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (activeJobs.length === 0) {
      // No jobs to watch — clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Already polling — let the existing interval continue
    if (intervalRef.current) return;

    const poll = async () => {
      const { activeJobs: jobs, resolveRunId, untrackJob } =
        useJobTrackerStore.getState();

      for (const tracked of jobs) {
        try {
          const job = await jobsApi.get(tracked.jobId);

          // Resolve run_id if not yet known
          if (!tracked.runId) {
            const runId = (job.progress as Record<string, unknown>)
              ?.run_id as string | undefined;
            if (runId) {
              resolveRunId(tracked.jobId, runId);
            }
          }

          // Check terminal state
          if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            const runId =
              tracked.runId ??
              ((job.progress as Record<string, unknown>)?.run_id as
                | string
                | undefined);

            // Check if user is already viewing this run's detail page
            const currentPath = window.location.pathname;
            const isOnRunDetail =
              runId != null && isRunDetailPath(currentPath, runId);

            if (!isOnRunDetail) {
              if (job.status === 'completed') {
                notificationService.notify({
                  type: 'success',
                  message: `${tracked.label} completed`,
                  title: 'Job Complete',
                  dismissible: true,
                  priority: 'normal',
                  ...(runId
                    ? {
                        action: {
                          label: 'View Run',
                          onClick: () =>
                            navigate(runDetailForApp(tracked.appId, runId)),
                        },
                      }
                    : {}),
                });
              } else if (job.status === 'failed') {
                notificationService.error(
                  `${tracked.label} failed${job.errorMessage ? `: ${job.errorMessage}` : ''}`,
                  'Job Failed',
                );
              } else if (job.status === 'cancelled') {
                notificationService.warning(
                  `${tracked.label} was cancelled`,
                  'Job Cancelled',
                );
              }
            }

            untrackJob(tracked.jobId);
          }
        } catch {
          // Transient error — skip this cycle, try again next interval
        }
      }
    };

    // Run immediately, then set interval
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeJobs.length, navigate]);

  return null;
}
