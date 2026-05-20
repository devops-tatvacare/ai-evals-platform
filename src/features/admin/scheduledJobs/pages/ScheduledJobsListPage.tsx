import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import cronstrue from 'cronstrue';
import { CalendarClock, History, Play, Pencil, Trash2, Plus, Lock } from 'lucide-react';
import { Button, EmptyState, ConfirmDialog, DataTable, type ColumnDef, LoadingState, PageSurface, RowActionsMenu, Tooltip } from '@/components/ui';
import { PAGE_METADATA } from '@/config/pageMetadata';
import { useScheduledJobsStore } from '@/stores/scheduledJobsStore';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils';
import { ScheduleOverlay } from '../components/ScheduleOverlay';
import { ScheduleHistoryOverlay } from '../components/ScheduleHistoryOverlay';
import type { Schedule } from '../types';

function cronHumanPreview(expression: string): string {
  try {
    return cronstrue.toString(expression, { use24HourTimeFormat: true });
  } catch {
    return 'Invalid cron';
  }
}

function relative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (Math.abs(diffMs) < 60_000) return 'now';
  if (absMinutes < 60) return diffMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return diffMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

/** Forward-only renderer for the "Next check" column.
 *
 * ``scheduled_jobs.next_check_at`` can land in the past briefly: between a
 * cron tick being due and the scheduler loop claiming it (up to the
 * scheduler interval, ~60s). Showing "2m ago" in a column labelled "Next
 * check" reads like a bug. Instead:
 *   - schedule disabled            → "paused"
 *   - cycle currently firing       → "running"
 *   - next_check_at in the past    → "due"
 *   - next_check_at in the future  → "in Xm / Xh / Xd"
 *   - next_check_at null           → "—"
 */
function nextCheckLabel(schedule: Schedule): string {
  if (!schedule.enabled) return 'paused';
  if (schedule.currentCycleStartedAt) return 'running';
  if (!schedule.nextCheckAt) return '—';
  const diffMs = new Date(schedule.nextCheckAt).getTime() - Date.now();
  if (diffMs <= 60_000) return 'due';
  return relative(schedule.nextCheckAt);
}

const RUN_STATE_STYLES: Record<string, { label: string; classes: string }> = {
  queued: { label: 'Queued', classes: 'bg-sky-500/15 text-sky-400' },
  running: { label: 'Running', classes: 'bg-blue-500/15 text-blue-400' },
  retryable_failed: { label: 'Retrying', classes: 'bg-amber-500/15 text-amber-400' },
  failed: { label: 'Failed', classes: 'bg-rose-500/15 text-rose-400' },
  cancelled: { label: 'Cancelled', classes: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' },
  completed: { label: 'Completed', classes: 'bg-emerald-500/15 text-emerald-400' },
};

function LastFireChip({ status }: { status: string | null }) {
  if (!status) return null;
  const entry = RUN_STATE_STYLES[status] ?? { label: status, classes: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]' };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', entry.classes)}>
      {entry.label}
    </span>
  );
}

export function ScheduledJobsListPage() {
  const schedules = useScheduledJobsStore((state) => state.schedules);
  const isLoading = useScheduledJobsStore((state) => state.isLoading);
  const error = useScheduledJobsStore((state) => state.error);
  const registry = useScheduledJobsStore((state) => state.registry);
  const load = useScheduledJobsStore((state) => state.load);
  const loadRegistry = useScheduledJobsStore((state) => state.loadRegistry);
  const remove = useScheduledJobsStore((state) => state.remove);
  const toggle = useScheduledJobsStore((state) => state.toggle);
  const fireNow = useScheduledJobsStore((state) => state.fireNow);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyScheduleId, setHistoryScheduleId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link from email CTAs (?history=<defId>&run=<runId>). The notify
  // mail subsystem links here so an admin landing from a failure alert
  // opens the matching run history overlay directly.
  const historyParam = searchParams.get('history');
  const focusFireId = searchParams.get('run');

  useEffect(() => {
    void load();
    void loadRegistry();
  }, [load, loadRegistry]);

  useEffect(() => {
    if (historyParam && schedules.some((s) => s.id === historyParam)) {
      setHistoryScheduleId(historyParam);
    }
  }, [historyParam, schedules]);

  const clearDeepLinkParams = useCallback(() => {
    if (!historyParam && !focusFireId) return;
    const next = new URLSearchParams(searchParams);
    next.delete('history');
    next.delete('run');
    setSearchParams(next, { replace: true });
  }, [historyParam, focusFireId, searchParams, setSearchParams]);

  const deleteTarget = useMemo(
    () => schedules.find((s) => s.id === deletingId) ?? null,
    [schedules, deletingId],
  );
  const historyTarget = useMemo(
    () => schedules.find((s) => s.id === historyScheduleId) ?? null,
    [schedules, historyScheduleId],
  );
  const workloadLabels = useMemo(
    () =>
      new Map(
        (registry?.workloads ?? []).map((workload) => [
          `${workload.appId}:${workload.jobType}`,
          workload.label,
        ]),
      ),
    [registry?.workloads],
  );

  const handleToggle = useCallback(async (schedule: Schedule) => {
    try {
      await toggle(schedule.id);
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to toggle schedule');
    }
  }, [toggle]);

  const handleFireNow = useCallback(async (schedule: Schedule) => {
    try {
      await fireNow(schedule.id);
      notificationService.success(`Fired "${schedule.name}" now.`);
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to fire schedule');
    }
  }, [fireNow]);

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await remove(deletingId);
      notificationService.success('Schedule deleted.');
    } catch (e) {
      notificationService.error(e instanceof Error ? e.message : 'Failed to delete schedule');
    } finally {
      setDeletingId(null);
    }
  };

  // Hide the header button on empty state so the EmptyState's own CTA is the
  // single call to action (matches `RolesTab` and `InviteLinksSection` patterns).
  const isEmpty = !isLoading && !error && schedules.length === 0;
  const headerActions = isEmpty ? undefined : (
    <Button onClick={() => { setEditing(null); setOverlayOpen(true); }} className="gap-1.5">
      <Plus className="h-4 w-4" />
      Create Schedule
    </Button>
  );

  const columns = useMemo((): ColumnDef<Schedule>[] => [
    {
      key: 'name',
      header: 'Name',
      width: 'min-w-[200px]',
      textBehavior: 'wrap',
      render: (schedule) => (
        <span className="font-medium text-[var(--text-primary)]">{schedule.name}</span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: 'w-[110px]',
      render: (schedule) =>
        schedule.isPlatformManaged ? (
          <Tooltip
            position="top"
            content="Platform-managed: seeded by the platform and read-only from tenant accounts."
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
              <Lock className="h-2.5 w-2.5" />
              Platform
            </span>
          </Tooltip>
        ) : (
          <span className="text-[var(--text-muted)]">Tenant</span>
        ),
    },
    {
      key: 'app',
      header: 'App',
      width: 'w-[140px]',
      textBehavior: 'truncate',
      render: (schedule) => (
        <span className="text-[var(--text-secondary)]">{schedule.appId}</span>
      ),
    },
    {
      key: 'workload',
      header: 'Workload',
      width: 'min-w-[180px]',
      textBehavior: 'wrap',
      render: (schedule) => (
        <span className="text-[var(--text-primary)]">
          {workloadLabels.get(`${schedule.appId}:${schedule.jobType}`) ?? schedule.jobType}
        </span>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      width: 'min-w-[170px]',
      textBehavior: 'wrap',
      render: (schedule) => (
        <Tooltip position="top" content={<span className="font-mono text-[11px]">{schedule.cron}</span>}>
          <span className="cursor-default text-[var(--text-primary)]">{cronHumanPreview(schedule.cron)}</span>
        </Tooltip>
      ),
    },
    {
      key: 'next-check',
      header: 'Next check',
      width: 'w-[110px]',
      render: (schedule) => {
        const label = nextCheckLabel(schedule);
        const absolute = schedule.nextCheckAt ? new Date(schedule.nextCheckAt).toLocaleString() : undefined;
        return (
          <span className="tabular-nums text-[var(--text-secondary)]" title={absolute}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'last-fire',
      header: 'Last fire',
      width: 'w-[170px]',
      render: (schedule) => {
        if (!schedule.lastFireAt) {
          return <span className="text-[var(--text-muted)]">—</span>;
        }
        const absolute = new Date(schedule.lastFireAt).toLocaleString();
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={absolute}>
            <span className="tabular-nums text-[var(--text-secondary)]">{relative(schedule.lastFireAt)}</span>
            <LastFireChip status={schedule.lastFireStatus} />
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: 'w-[110px]',
      render: (schedule) => {
        const chip = (
          <button
            onClick={() => { if (!schedule.isPlatformManaged) void handleToggle(schedule); }}
            disabled={schedule.isPlatformManaged}
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
              schedule.enabled
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
              schedule.isPlatformManaged && 'cursor-not-allowed opacity-60',
            )}
            title={
              schedule.isPlatformManaged
                ? 'Platform-managed schedule — toggle via platform operators'
                : schedule.enabled ? 'Disable' : 'Enable'
            }
          >
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </button>
        );
        if (!schedule.lastSkipReason) return chip;
        return (
          <Tooltip
            position="top"
            maxWidth={320}
            content={
              <div className="space-y-1 text-xs leading-snug">
                <div>
                  <span className="font-medium">Last skip: </span>
                  {schedule.lastSkipReason}
                </div>
                <div className="text-[var(--text-muted)]">
                  Next check {relative(schedule.nextCheckAt)}
                </div>
              </div>
            }
          >
            <span className="inline-flex items-center gap-1">
              {chip}
              <span className="text-[var(--color-warning)]" aria-label="Skipped">!</span>
            </span>
          </Tooltip>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: 'w-[44px]',
      cellClassName: 'text-right',
      render: (schedule) => {
        const locked = schedule.isPlatformManaged;
        const lockedTitle = 'Platform-managed schedule — managed by platform operators';
        return (
          <RowActionsMenu
            open={openMenuId === schedule.id}
            onOpenChange={(next) => setOpenMenuId(next ? schedule.id : null)}
            actions={[
              {
                id: 'history',
                icon: History,
                label: 'Run history',
                onClick: () => setHistoryScheduleId(schedule.id),
              },
              {
                id: 'edit',
                icon: Pencil,
                label: 'Edit',
                onClick: () => { setEditing(schedule); setOverlayOpen(true); },
                disabled: locked,
                title: locked ? lockedTitle : undefined,
              },
              {
                id: 'fire',
                icon: Play,
                label: 'Fire now',
                onClick: () => { void handleFireNow(schedule); },
                disabled: locked,
                title: locked ? lockedTitle : undefined,
              },
              {
                id: 'delete',
                icon: Trash2,
                label: 'Delete',
                onClick: () => setDeletingId(schedule.id),
                danger: true,
                disabled: locked,
                title: locked ? lockedTitle : undefined,
              },
            ]}
          />
        );
      },
    },
  ], [handleFireNow, handleToggle, openMenuId, workloadLabels]);

  const { icon, title } = PAGE_METADATA.scheduledJobs;

  return (
    <PageSurface
      icon={icon}
      title={title}
      subtitle="Tenant-scoped cron schedules that enqueue platform jobs."
      actions={headerActions}
    >
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <EmptyState
          icon={CalendarClock}
          title="Failed to load schedules"
          description={error}
          action={{ label: 'Retry', onClick: load }}
          fill
        />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedules yet"
          description="Create your first scheduled job to enqueue workloads on a cron cadence."
          action={{ label: 'Create Schedule', onClick: () => { setEditing(null); setOverlayOpen(true); } }}
          fill
        />
      ) : (
        <DataTable
          data={schedules}
          columns={columns}
          keyExtractor={(schedule) => schedule.id}
          emptyIcon={CalendarClock}
          emptyTitle="No schedules yet"
          emptyDescription="Create your first scheduled job to enqueue workloads on a cron cadence."
          minWidth="1280px"
        />
      )}

      {overlayOpen ? (
        <ScheduleOverlay
          schedule={editing}
          onClose={() => setOverlayOpen(false)}
        />
      ) : null}

      {historyTarget ? (
        <ScheduleHistoryOverlay
          schedule={historyTarget}
          focusFireId={focusFireId}
          onClose={() => {
            setHistoryScheduleId(null);
            clearDeepLinkParams();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          isOpen={true}
          title="Delete schedule"
          description={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setDeletingId(null)}
        />
      ) : null}
    </PageSurface>
  );
}
