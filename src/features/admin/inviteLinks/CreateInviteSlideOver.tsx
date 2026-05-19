import { useEffect, useId, useMemo, useState } from 'react';
import { X, Link2 } from 'lucide-react';

import {
  Button,
  Combobox,
  Input,
  RightSlideOverShell,
  Select,
  type SelectOption,
  type ComboboxOption,
} from '@/components/ui';
import type {
  CreateInviteLinkRequest,
  CreateInviteLinkResponse,
  InviteEmailStatus,
} from '@/services/api/adminApi';
import type { RoleResponse } from '@/services/api/rolesApi';

import {
  createInviteSchema,
  EMAIL_LOCAL_PART,
} from './inviteLinks.schema';
import { handleEmailStatusToast, inviteLinksCopy as copy } from './inviteLinks.copy';

const EXPIRY_OPTIONS: SelectOption[] = [
  { label: '1 hour', value: '1' },
  { label: '8 hours', value: '8' },
  { label: '24 hours', value: '24' },
  { label: '3 days', value: '72' },
  { label: '7 days', value: '168' },
  { label: '14 days', value: '336' },
  { label: '30 days', value: '720' },
];

const DEFAULT_EXPIRES_IN_HOURS = 168;

export interface CreateInviteSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  roles: RoleResponse[];
  allowedDomains?: string[];
  /** Performs the POST. Caller owns error toasts on rejection; success toasts
   *  flow through {@link handleEmailStatusToast}. */
  createInvite: (body: CreateInviteLinkRequest) => Promise<CreateInviteLinkResponse>;
  /** Invoked after a successful create so the parent can refresh + show the
   *  generated link strip. */
  onCreated: (result: CreateInviteLinkResponse) => void;
}

interface FormState {
  roleId: string;
  label: string;
  expiresInHours: number;
  maxUses: string;
  recipientEmail: string;
  userName: string;
}

function blankForm(roles: RoleResponse[]): FormState {
  return {
    roleId: roles[0]?.id ?? '',
    label: '',
    expiresInHours: DEFAULT_EXPIRES_IN_HOURS,
    maxUses: '',
    recipientEmail: '',
    userName: '',
  };
}

function isDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return true;
  const lower = email.trim().toLowerCase();
  return allowedDomains.some((d) => lower.endsWith(d.toLowerCase()));
}

export function CreateInviteSlideOver({
  isOpen,
  onClose,
  roles,
  allowedDomains = [],
  createInvite,
  onCreated,
}: CreateInviteSlideOverProps) {
  const titleId = useId();
  const [form, setForm] = useState<FormState>(() => blankForm(roles));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-blank when reopened.
  useEffect(() => {
    if (isOpen) {
      setForm(blankForm(roles));
      setErrors({});
    }
  }, [isOpen, roles]);

  const roleOptions = useMemo<ComboboxOption[]>(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles],
  );

  // Informational, not blocking — server is the authority.
  const domainHint = useMemo(() => {
    const email = form.recipientEmail.trim();
    if (!email || !EMAIL_LOCAL_PART.test(email)) return null;
    if (!allowedDomains.length) return null;
    return isDomainAllowed(email, allowedDomains) ? null : copy.toasts.domainWarning;
  }, [form.recipientEmail, allowedDomains]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    const parsed = createInviteSchema.safeParse({
      roleId: form.roleId,
      label: form.label.trim() || undefined,
      expiresInHours: form.expiresInHours,
      maxUses: form.maxUses.trim() ? Number(form.maxUses) : undefined,
      recipientEmail: form.recipientEmail.trim() || undefined,
      userName: form.userName.trim() || undefined,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const body: CreateInviteLinkRequest = {
      roleId: parsed.data.roleId,
      expiresInHours: parsed.data.expiresInHours,
    };
    if (parsed.data.label) body.label = parsed.data.label;
    if (parsed.data.maxUses != null) body.maxUses = parsed.data.maxUses;
    if (parsed.data.recipientEmail) body.recipientEmail = parsed.data.recipientEmail;
    if (parsed.data.userName) body.userName = parsed.data.userName;

    setIsSubmitting(true);
    try {
      const result = await createInvite(body);
      onCreated(result);
      await handleEmailStatusToast(result.emailStatus as InviteEmailStatus, result.inviteUrl);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={onClose} labelledBy={titleId}>
      <div className="flex items-start justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          {copy.slideOverTitle}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.role.label}
            <span className="text-[var(--color-status-error)]"> *</span>
          </label>
          <Combobox
            value={form.roleId}
            onChange={(v) => setField('roleId', v ?? '')}
            options={roleOptions}
            placeholder={copy.fields.role.placeholder}
          />
          {errors.roleId && (
            <p className="mt-1 text-[12px] text-[var(--color-status-error)]">{errors.roleId}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.label.label}
          </label>
          <Input
            value={form.label}
            onChange={(e) => setField('label', e.target.value)}
            placeholder={copy.fields.label.placeholder}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{copy.fields.label.help}</p>
          {errors.label && (
            <p className="mt-1 text-[12px] text-[var(--color-status-error)]">{errors.label}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.expiresIn.label}
          </label>
          <Select
            value={String(form.expiresInHours)}
            onChange={(v) => setField('expiresInHours', Number(v))}
            options={EXPIRY_OPTIONS}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.maxUses.label}
          </label>
          <Input
            type="number"
            min={1}
            value={form.maxUses}
            onChange={(e) => setField('maxUses', e.target.value)}
            placeholder={copy.fields.maxUses.placeholder}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{copy.fields.maxUses.help}</p>
          {errors.maxUses && (
            <p className="mt-1 text-[12px] text-[var(--color-status-error)]">{errors.maxUses}</p>
          )}
        </div>

        <div className="pt-2 border-t border-[var(--border-subtle)]" />

        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.recipientEmail.label}
          </label>
          <Input
            type="email"
            value={form.recipientEmail}
            onChange={(e) => setField('recipientEmail', e.target.value)}
            placeholder={copy.fields.recipientEmail.placeholder}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{copy.fields.recipientEmail.help}</p>
          {errors.recipientEmail && (
            <p className="mt-1 text-[12px] text-[var(--color-status-error)]">{errors.recipientEmail}</p>
          )}
          {!errors.recipientEmail && domainHint && (
            <p className="mt-1 text-[12px] text-[var(--color-status-warning)]">{domainHint}</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
            {copy.fields.userName.label}
          </label>
          <Input
            value={form.userName}
            onChange={(e) => setField('userName', e.target.value)}
            placeholder={copy.fields.userName.placeholder}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{copy.fields.userName.help}</p>
          {errors.userName && (
            <p className="mt-1 text-[12px] text-[var(--color-status-error)]">{errors.userName}</p>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border-default)] px-5 py-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onClose}>
          {copy.buttons.cancel}
        </Button>
        <Button
          size="md"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          icon={Link2}
        >
          {isSubmitting ? copy.buttons.submitting : copy.buttons.submit}
        </Button>
      </div>
    </RightSlideOverShell>
  );
}
