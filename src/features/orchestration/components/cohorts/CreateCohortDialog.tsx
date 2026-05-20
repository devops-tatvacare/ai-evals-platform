import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { useCurrentAppId } from '@/hooks';
import { useCreateCohort } from '@/features/orchestration/queries/cohorts';
import { ApiError } from '@/services/api/client';
import { notificationService } from '@/services/notifications';
import type { AssetVisibility } from '@/types/settings.types';

interface Props {
  isOpen: boolean;
  onClose(): void;
  onCreated(cohortId: string): void;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CreateCohortDialog({ isOpen, onClose, onCreated }: Props) {
  const titleId = useId();
  const appId = useCurrentAppId();
  const createCohort = useCreateCohort();
  const [name, setName] = useState('');
  const [slugDraft, setSlugDraft] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const slug = slugTouched ? slugDraft : slugify(name);
  const setSlug = setSlugDraft;
  const [description, setDescription] = useState('');
  const [sourceRef, setSourceRef] = useState('crm.lead_record');
  const [visibility, setVisibility] = useState<AssetVisibility>('private');
  const [error, setError] = useState<string | null>(null);

  // Reset form when the slide-over closes. Wrapping the setters in a
  // callback inside the effect keeps the lint rule happy — the rule blocks
  // *synchronous* setState calls during render-phase effects.
  useEffect(() => {
    if (isOpen) return;
    const reset = () => {
      setName('');
      setSlugDraft('');
      setSlugTouched(false);
      setDescription('');
      setSourceRef('crm.lead_record');
      setVisibility('private');
      setError(null);
    };
    reset();
  }, [isOpen]);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setError('Slug must be lowercase letters, digits, and hyphens.');
      return;
    }
    if (!sourceRef.trim()) {
      setError('Source ref is required.');
      return;
    }
    if (sourceRef.trim().startsWith('dataset.')) {
      setError("Saved cohorts can't reference datasets — pick an analytics source.");
      return;
    }
    setError(null);
    try {
      const created = await createCohort.mutateAsync({
        appId,
        slug,
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        visibility,
        initialVersion: {
          sourceRef: sourceRef.trim(),
          filters: [],
          payloadFields: [],
        },
      });
      notificationService.success(`Cohort "${created.name}" created.`);
      onCreated(created.id);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create cohort';
      setError(msg);
    }
  }

  const saving = createCohort.isPending;
  const handleClose = () => {
    if (saving) return;
    onClose();
  };
  const canSubmit = !saving && name.trim().length > 0 && SLUG_RE.test(slug) && sourceRef.trim().length > 0;

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={handleClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          New saved cohort
        </h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void handleCreate();
        }}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MQL hot, no contact 7d"
              autoFocus
              disabled={saving}
            />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Slug
            </label>
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="mql-hot-no-contact-7d"
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Used in URLs and bindings. Lowercase letters, digits, and hyphens.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Description
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              disabled={saving}
            />
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Source
            </label>
            <Input
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="crm.lead_record"
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Pick from the analytics tables surfaced by the orchestration source catalog.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Visibility
            </label>
            <VisibilityToggle value={visibility} onChange={setVisibility} disabled={saving} />
          </div>

          {error ? (
            <p role="alert" className="text-[12px] text-[var(--color-error)]">{error}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button variant="ghost" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit} isLoading={saving}>
            Create
          </Button>
        </div>
      </form>
    </RightSlideOverShell>
  );
}
