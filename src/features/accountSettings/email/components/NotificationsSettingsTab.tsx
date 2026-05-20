import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { LoadingState } from '@/components/ui/LoadingState';
import { Alert } from '@/components/ui/Alert';
import { cn } from '@/utils/cn';
import { emailSettingsCopy } from '../emailSettings.copy';
import { EMAIL_REGEX } from '../emailSettings.schema';
import type { NotificationsFormValue, NotificationToggle } from '../notificationsForm';
import type { RecentSendRow } from '../types';
import { EventGroupCard } from './EventGroupCard';
import { RecentSendsTable } from './RecentSendsTable';

interface Props {
  value: NotificationsFormValue;
  onChange: (next: NotificationsFormValue) => void;
  loading: boolean;
  isError: boolean;
  recentSends: RecentSendRow[];
  recentLoading: boolean;
  recentError: boolean;
}

function groupToggles(
  toggles: NotificationToggle[],
): Array<{ group: string; rows: NotificationToggle[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, NotificationToggle[]>();
  for (const row of toggles) {
    if (!byGroup.has(row.group)) {
      byGroup.set(row.group, []);
      order.push(row.group);
    }
    byGroup.get(row.group)!.push(row);
  }
  return order.map((group) => ({ group, rows: byGroup.get(group)! }));
}

export function NotificationsSettingsTab({
  value,
  onChange,
  loading,
  isError,
  recentSends,
  recentLoading,
  recentError,
}: Props) {
  const grouped = useMemo(() => groupToggles(value.toggles), [value.toggles]);

  const recipient = value.recipientEmail;
  const recipientInvalid = recipient.trim().length > 0 && !EMAIL_REGEX.test(recipient.trim());

  const setRecipient = (next: string) => onChange({ ...value, recipientEmail: next });
  const setToggle = (eventType: string, next: boolean) =>
    onChange({
      ...value,
      toggles: value.toggles.map((t) =>
        t.eventType === eventType ? { ...t, isActive: next } : t,
      ),
    });

  if (loading && value.toggles.length === 0) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <p className="text-[13px] text-[var(--color-error)]">{emailSettingsCopy.error.listFailed}</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">{emailSettingsCopy.subtitle}</Alert>

      <section className="flex items-center justify-between gap-6 rounded-[12px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3.5">
        <div className="min-w-0">
          <label htmlFor="notification-recipient" className="block text-[13px] font-medium text-[var(--text-primary)]">
            {emailSettingsCopy.recipientLabel}
          </label>
          <p
            className={cn(
              'mt-0.5 text-[12px]',
              recipientInvalid ? 'text-[var(--color-error)]' : 'text-[var(--text-muted)]',
            )}
          >
            {recipientInvalid ? emailSettingsCopy.error.recipientInvalid : emailSettingsCopy.recipientHint}
          </p>
        </div>
        <Input
          id="notification-recipient"
          type="email"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="name@workspace.com"
          className={cn('h-9 w-[280px] shrink-0', recipientInvalid && 'border-[var(--color-error)]')}
          aria-invalid={recipientInvalid}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {grouped.map(({ group, rows }) => (
          <EventGroupCard key={group} title={emailSettingsCopy.groups[group] ?? group}>
            {rows.map((row) => (
              <div
                key={row.eventType}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 transition-colors',
                  row.isRequired ? 'opacity-90' : 'hover:bg-[var(--interactive-secondary)]',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-[13px] text-[var(--text-primary)]">
                    {emailSettingsCopy.events[row.eventType] ?? row.eventType}
                  </span>
                  {row.isRequired ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
                      title={emailSettingsCopy.error.subscriptionLocked}
                    >
                      <Lock className="h-3 w-3" />
                      {emailSettingsCopy.requiredHint}
                    </span>
                  ) : null}
                </div>
                <Switch
                  size="sm"
                  checked={row.isActive}
                  disabled={row.isRequired}
                  onCheckedChange={(next) => setToggle(row.eventType, next)}
                  aria-label={emailSettingsCopy.events[row.eventType] ?? row.eventType}
                />
              </div>
            ))}
          </EventGroupCard>
        ))}
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {emailSettingsCopy.recentSendsHeader}
        </h2>
        <p className="mb-3 text-[12px] text-[var(--text-tertiary)]">
          {emailSettingsCopy.recentSendsSubtitle}
        </p>
        <RecentSendsTable rows={recentSends} loading={recentLoading} />
        {recentError ? (
          <p className="mt-2 text-[12px] text-[var(--color-error)]">
            {emailSettingsCopy.error.recentSendsFailed}
          </p>
        ) : null}
      </section>
    </div>
  );
}
