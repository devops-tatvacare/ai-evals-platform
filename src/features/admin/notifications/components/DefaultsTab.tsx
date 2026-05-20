import { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils';
import { notificationService } from '@/services/notifications';
import { decodeApiError, summarizeApiErrorBody } from '@/features/orchestration/contracts/errorDecoder';
import { EmailChipInput } from '@/features/admin/scheduledJobs/components/EmailChipInput';
import { emailSettingsCopy } from '@/features/accountSettings/email/emailSettings.copy';
import { adminNotificationsCopy } from '../adminNotifications.copy';
import { useNotificationDefaults, useUpdateDefault } from '../queries';
import type { NotificationDefaultRow } from '../types';

interface RowDraft {
  isRequiredForAll: boolean;
  alwaysNotifyEmails: string[];
}

function isDirty(server: NotificationDefaultRow, draft: RowDraft): boolean {
  if (server.isRequiredForAll !== draft.isRequiredForAll) return true;
  const a = [...server.alwaysNotifyEmails].sort();
  const b = [...draft.alwaysNotifyEmails].sort();
  if (a.length !== b.length) return true;
  return a.some((v, i) => v !== b[i]);
}

export function DefaultsTab() {
  const query = useNotificationDefaults();
  const mutation = useUpdateDefault();
  // Drafts only hold user-edited overrides. Rows without a draft entry fall
  // back to server data; saves clear the entry by relying on the mutation's
  // cache update (which surfaces the new server value).
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  const groups = useMemo(() => {
    if (!query.data) return [] as Array<{ group: string; rows: NotificationDefaultRow[] }>;
    const ordered: string[] = [];
    const byGroup = new Map<string, NotificationDefaultRow[]>();
    for (const row of query.data.defaults) {
      if (!byGroup.has(row.group)) {
        byGroup.set(row.group, []);
        ordered.push(row.group);
      }
      byGroup.get(row.group)!.push(row);
    }
    return ordered.map((group) => ({ group, rows: byGroup.get(group)! }));
  }, [query.data]);

  if (query.isLoading) {
    return <p className="text-[13px] text-[var(--text-secondary)]">{adminNotificationsCopy.defaults.loading}</p>;
  }
  if (query.isError || !query.data) {
    return <p className="text-[13px] text-[var(--color-error)]">{adminNotificationsCopy.defaults.loadFailed}</p>;
  }

  const updateDraft = (eventType: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [eventType]: {
        ...prev[eventType],
        ...patch,
      },
    }));
  };

  const handleSave = (server: NotificationDefaultRow) => {
    const draft = drafts[server.eventType] ?? {
      isRequiredForAll: server.isRequiredForAll,
      alwaysNotifyEmails: server.alwaysNotifyEmails,
    };
    mutation.mutate(
      {
        eventType: server.eventType,
        isRequiredForAll: draft.isRequiredForAll,
        alwaysNotifyEmails: draft.alwaysNotifyEmails,
      },
      {
        onSuccess: () => {
          // Drop the local override now that server reflects the saved value.
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[server.eventType];
            return next;
          });
          notificationService.success(adminNotificationsCopy.toast.defaultsUpdated);
        },
        onError: (err) => {
          const decoded = decodeApiError(err);
          notificationService.error(
            summarizeApiErrorBody(decoded, adminNotificationsCopy.defaults.saveFailed),
          );
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ group, rows }) => (
        <section
          key={group}
          className="rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)]"
        >
          <header className="border-b border-[var(--border-subtle)] px-4 py-2.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              {emailSettingsCopy.groups[group] ?? group}
            </h3>
          </header>
          <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {rows.map((row) => {
              const draft = drafts[row.eventType] ?? {
                isRequiredForAll: row.isRequiredForAll,
                alwaysNotifyEmails: row.alwaysNotifyEmails,
              };
              const dirty = drafts[row.eventType] !== undefined && isDirty(row, draft);
              const isPending =
                mutation.isPending && mutation.variables?.eventType === row.eventType;
              return (
                <div
                  key={row.eventType}
                  className="grid grid-cols-1 gap-4 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,1.4fr)_auto] lg:items-start"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-primary)]">
                      {emailSettingsCopy.events[row.eventType] ?? row.eventType}
                    </div>
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {adminNotificationsCopy.defaults.requiredHelp}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {adminNotificationsCopy.defaults.alwaysNotifyLabel}
                    </div>
                    <EmailChipInput
                      value={draft.alwaysNotifyEmails}
                      onChange={(next) =>
                        updateDraft(row.eventType, { alwaysNotifyEmails: next })
                      }
                      placeholder={adminNotificationsCopy.defaults.alwaysNotifyHelp}
                      inputAriaLabel={adminNotificationsCopy.defaults.alwaysNotifyLabel}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end lg:gap-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        {adminNotificationsCopy.defaults.requiredLabel}
                      </span>
                      <Switch
                        size="sm"
                        checked={draft.isRequiredForAll}
                        onCheckedChange={(next) =>
                          updateDraft(row.eventType, { isRequiredForAll: next })
                        }
                        disabled={isPending}
                        aria-label={adminNotificationsCopy.defaults.requiredLabel}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!dirty || isPending}
                      isLoading={isPending}
                      onClick={() => handleSave(row)}
                      className={cn(!dirty && 'invisible')}
                    >
                      {adminNotificationsCopy.defaults.save}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
