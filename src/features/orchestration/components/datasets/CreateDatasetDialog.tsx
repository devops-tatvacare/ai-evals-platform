import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { RightSlideOverShell } from '@/components/ui/RightSlideOverShell';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetResponse,
} from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';
import type { AssetVisibility } from '@/types/settings.types';

interface Props {
  isOpen: boolean;
  appId: string;
  onClose(): void;
  onCreated(dataset: DatasetResponse): void;
}

const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

export function CreateDatasetDialog({ isOpen, appId, onClose, onCreated }: Props) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<AssetVisibility>('private');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on close so re-opening starts blank instead of replaying the last
  // attempt's draft (parent always renders this so the shell can drive its
  // exit animation — without this we'd leak state between sessions).
  useEffect(() => {
    if (isOpen) return;
    setName('');
    setDescription('');
    setVisibility('private');
    setError(null);
    setSaving(false);
  }, [isOpen]);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const dataset = await orchestrationDatasetsApi.create({
        appId,
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        visibility,
      });
      notificationService.success(`Dataset "${dataset.name}" created.`);
      onCreated(dataset);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to create dataset';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    onClose();
  }

  const canSubmit = !saving && name.trim().length > 0;

  return (
    <RightSlideOverShell isOpen={isOpen} onClose={handleClose} labelledBy={titleId}>
      <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-4">
        <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          New cohort dataset
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
              onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
              placeholder="e.g. DM2 Adherence Pilot — May 2026"
              maxLength={NAME_MAX}
              autoFocus
            />
            {error ? (
              <p className="mt-1 text-xs text-[var(--color-error)]">{error}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
              }
              placeholder="What's this cohort for?"
              rows={3}
              maxLength={DESCRIPTION_MAX}
              className="w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {description.length} / {DESCRIPTION_MAX}
            </p>
          </div>

          <div>
            <span className="mb-1 block text-[13px] font-medium text-[var(--text-secondary)]">
              Visibility
            </span>
            <div className="flex flex-col items-start gap-1">
              <VisibilityToggle value={visibility} onChange={setVisibility} variant="toolbar" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button type="button" variant="secondary" size="md" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={!canSubmit} isLoading={saving}>
            Create
          </Button>
        </div>
      </form>
    </RightSlideOverShell>
  );
}
