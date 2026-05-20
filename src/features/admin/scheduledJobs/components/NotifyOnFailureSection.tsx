/**
 * Notifications section for the scheduled-job slide-over.
 *
 * Collapsible by default; auto-opens when at least one notification is
 * configured on mount. Renders inside RightSlideOverShell — never a modal.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { EmailChipInput } from './EmailChipInput';
import { notificationsCopy } from '../scheduledJobs.copy';
import { MAX_NOTIFY_EMAILS } from '../scheduledJobs.schema';

interface Props {
  notifyOwnerOnFailure: boolean;
  notifyEmailsOnFailure: string[];
  ownerEmail: string | null;
  allowedDomains?: string[];
  onChange: (next: {
    notifyOwnerOnFailure: boolean;
    notifyEmailsOnFailure: string[];
  }) => void;
}

export function NotifyOnFailureSection({
  notifyOwnerOnFailure,
  notifyEmailsOnFailure,
  ownerEmail,
  allowedDomains = [],
  onChange,
}: Props) {
  const hasAnyConfigured =
    notifyOwnerOnFailure || notifyEmailsOnFailure.length > 0;
  const [open, setOpen] = useState<boolean>(hasAnyConfigured);

  const updateOwner = (next: boolean) => {
    onChange({ notifyOwnerOnFailure: next, notifyEmailsOnFailure });
  };
  const updateEmails = (next: string[]) => {
    onChange({ notifyOwnerOnFailure, notifyEmailsOnFailure: next });
  };

  return (
    <section className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left',
          'text-xs font-semibold text-[var(--text-primary)]',
        )}
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          )}
          {notificationsCopy.sectionTitle}
        </span>
        {hasAnyConfigured ? (
          <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
            {(notifyOwnerOnFailure ? 1 : 0) + notifyEmailsOnFailure.length} configured
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-[var(--border-subtle)] px-3 py-3">
          <p className="text-[11px] text-[var(--text-muted)]">
            {notificationsCopy.sectionSubtitle}
          </p>

          <label className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={notifyOwnerOnFailure}
              onChange={(e) => updateOwner(e.target.checked)}
              disabled={!ownerEmail}
              className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
            />
            <span>
              <span className="block">{notificationsCopy.ownerCheckboxLabel}</span>
              {ownerEmail ? (
                <span className="block text-[11px] text-[var(--text-muted)]">
                  {ownerEmail}
                </span>
              ) : (
                <span className="block text-[11px] text-[var(--color-warning-dark)]">
                  {notificationsCopy.ownerHelpNoEmail}
                </span>
              )}
            </span>
          </label>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {notificationsCopy.extraEmailsLabel}
            </label>
            <EmailChipInput
              value={notifyEmailsOnFailure}
              onChange={updateEmails}
              placeholder={notificationsCopy.emailChipPlaceholder}
              allowedDomains={allowedDomains}
              invalidMessage={notificationsCopy.errorInvalidEmail}
              fullMessage={notificationsCopy.errorTooMany}
              domainWarningMessage={notificationsCopy.warningDomainNotAllowed}
              max={MAX_NOTIFY_EMAILS}
              inputAriaLabel={notificationsCopy.extraEmailsLabel}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {notificationsCopy.extraEmailsHelp}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
