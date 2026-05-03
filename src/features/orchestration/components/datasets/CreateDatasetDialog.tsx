import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/services/api/client';
import {
  orchestrationDatasetsApi,
  type DatasetResponse,
} from '@/services/api/orchestrationDatasets';
import { notificationService } from '@/services/notifications';

interface Props {
  isOpen: boolean;
  appId: string;
  onClose(): void;
  onCreated(dataset: DatasetResponse): void;
}

const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

export function CreateDatasetDialog({ isOpen, appId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName('');
    setDescription('');
    setError(null);
    setSaving(false);
  }

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
      });
      notificationService.success(`Dataset "${dataset.name}" created.`);
      onCreated(dataset);
      reset();
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
    reset();
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New cohort dataset">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
            placeholder="e.g. DM2 Adherence Pilot — May 2026"
            maxLength={NAME_MAX}
          />
          {error ? (
            <p className="text-xs text-[var(--color-error)]">{error}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]">
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
          <p className="text-[11px] text-[var(--text-muted)]">
            {description.length} / {DESCRIPTION_MAX}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
