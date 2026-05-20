/**
 * Generic email chip input.
 *
 * Reusable beyond scheduled jobs — any feature that needs a small set of
 * email recipients with format validation + optional allowed-domain hint
 * can mount this. Keeps copy abstracted via the consumer-supplied
 * placeholder so locale belongs to the parent feature.
 */
import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui';
import { cn } from '@/utils';
import {
  MAX_NOTIFY_EMAILS,
  isAllowedDomain,
  notifyEmailSchema,
} from '../scheduledJobs.schema';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  allowedDomains?: string[];
  invalidMessage?: string;
  fullMessage?: string;
  domainWarningMessage?: string;
  /** Caps the chip count. Defaults to MAX_NOTIFY_EMAILS. */
  max?: number;
  inputAriaLabel?: string;
}

export function EmailChipInput({
  value,
  onChange,
  placeholder,
  allowedDomains = [],
  invalidMessage,
  fullMessage,
  domainWarningMessage,
  max = MAX_NOTIFY_EMAILS,
  inputAriaLabel,
}: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCommit = () => {
    const candidate = draft.trim();
    if (!candidate) return;
    if (value.length >= max) {
      setError(fullMessage ?? 'Limit reached.');
      return;
    }
    const parsed = notifyEmailSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(invalidMessage ?? 'Enter a valid email address.');
      return;
    }
    if (value.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
      setDraft('');
      setError(null);
      return;
    }
    onChange([...value, candidate]);
    setDraft('');
    setError(null);
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      handleCommit();
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const handleRemove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const draftLooksLikeEmail = notifyEmailSchema.safeParse(draft.trim()).success;
  const draftDomainOutsideAllowed =
    draftLooksLikeEmail &&
    allowedDomains.length > 0 &&
    !isAllowedDomain(draft.trim(), allowedDomains);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1.5">
        {value.map((email, idx) => {
          const outside =
            allowedDomains.length > 0 && !isAllowedDomain(email, allowedDomains);
          return (
            <span
              key={`${email}-${idx}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                outside
                  ? 'bg-[var(--color-warning-light)] text-[var(--color-warning-dark)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]',
              )}
              title={outside ? domainWarningMessage : email}
            >
              {email}
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="rounded p-0.5 hover:bg-[var(--interactive-secondary)]"
                aria-label={`Remove ${email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKey}
          onBlur={() => {
            if (draft.trim()) handleCommit();
          }}
          placeholder={value.length >= max ? '' : placeholder}
          aria-label={inputAriaLabel}
          disabled={value.length >= max}
          className="!h-7 flex-1 !min-w-[160px] !border-0 !bg-transparent !px-1 !text-xs !shadow-none focus:!ring-0"
        />
      </div>
      {error ? (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>
      ) : draftDomainOutsideAllowed && domainWarningMessage ? (
        <p className="mt-1 text-[11px] text-[var(--color-warning-dark)]">
          {domainWarningMessage}
        </p>
      ) : null}
    </div>
  );
}
