import { useEffect, useMemo, useState } from 'react';
import cronstrue from 'cronstrue';
import { Plus, X } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { useScheduledJobsStore } from '@/stores/scheduledJobsStore';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils';
import type {
  RegisteredPredicate,
  Schedule,
  ScheduleOverride,
  SkipCriterion,
} from '../types';

interface Props {
  schedule: Schedule | null;
  onClose: () => void;
}

function humanPreview(expression: string): { text: string; valid: boolean } {
  try {
    return { text: cronstrue.toString(expression, { use24HourTimeFormat: true }), valid: true };
  } catch {
    return { text: 'Invalid cron expression', valid: false };
  }
}

function defaultArgsFor(predicate: RegisteredPredicate): Record<string, unknown> {
  if (predicate.defaultScope) {
    return { scope: predicate.defaultScope };
  }
  return {};
}

export function ScheduleOverlay({ schedule, onClose }: Props) {
  const loadRegistry = useScheduledJobsStore((state) => state.loadRegistry);
  const registry = useScheduledJobsStore((state) => state.registry);
  const createSchedule = useScheduledJobsStore((state) => state.create);
  const updateSchedule = useScheduledJobsStore((state) => state.update);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const isEdit = schedule !== null;

  const [name, setName] = useState(schedule?.name ?? '');
  const [description, setDescription] = useState(schedule?.description ?? '');
  const [appId, setAppId] = useState(schedule?.appId ?? '');
  const [jobType, setJobType] = useState(schedule?.jobType ?? '');
  const [scheduleKey, setScheduleKey] = useState(schedule?.scheduleKey ?? '');
  const [cron, setCron] = useState(schedule?.cron ?? '0 */6 * * *');
  const [paramsText, setParamsText] = useState(
    JSON.stringify(schedule?.params ?? {}, null, 2),
  );
  const [override, setOverride] = useState<ScheduleOverride>(
    schedule?.override ?? { skipCriteria: [], retryCount: 0, retryIntervalMinutes: 15, onExhaust: 'wait_next_tick' },
  );
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);

  const apps = registry?.apps ?? [];
  const workloadsForApp = useMemo(
    () => (registry?.workloads ?? []).filter((w) => w.appId === appId),
    [registry, appId],
  );
  const selectedWorkload = useMemo(
    () => workloadsForApp.find((w) => w.jobType === jobType) ?? null,
    [workloadsForApp, jobType],
  );
  const predicates = registry?.predicates ?? [];
  const onExhaustModes = registry?.onExhaustModes ?? ['wait_next_tick'];

  // Auto-pick a workload when the app changes and only one is available.
  useEffect(() => {
    if (!isEdit && appId && workloadsForApp.length === 1) {
      setJobType(workloadsForApp[0].jobType);
    }
  }, [appId, workloadsForApp, isEdit]);

  useEffect(() => {
    if (isEdit || !selectedWorkload) {
      return;
    }
    setParamsText(JSON.stringify(selectedWorkload.defaultParams ?? {}, null, 2));
  }, [isEdit, selectedWorkload]);

  const cronPreview = humanPreview(cron);
  const paramsAreEditable = !selectedWorkload || selectedWorkload.launchSource === 'explicit_params';
  const paramsFieldLabel = paramsAreEditable ? 'Job params (JSON)' : 'Canonical job params preview';
  const paramsFieldHint = paramsAreEditable
    ? 'These params are enqueued with the job. `app_id` is auto-injected if omitted.'
    : 'Canonical launch params are generated from the selected source config/run and enqueued unchanged.';

  const handleAddSkipCriterion = () => {
    const first = predicates[0];
    if (!first) return;
    const criterion: SkipCriterion = { type: first.id, ...defaultArgsFor(first) };
    setOverride((prev) => ({
      ...prev,
      skipCriteria: [...(prev.skipCriteria ?? []), criterion],
    }));
  };

  const handleRemoveSkipCriterion = (index: number) => {
    setOverride((prev) => ({
      ...prev,
      skipCriteria: (prev.skipCriteria ?? []).filter((_, i) => i !== index),
    }));
  };

  const handleChangeSkipCriterion = (index: number, next: SkipCriterion) => {
    setOverride((prev) => ({
      ...prev,
      skipCriteria: (prev.skipCriteria ?? []).map((c, i) => (i === index ? next : c)),
    }));
  };

  const handleSave = async () => {
    setError(null);
    if (!cronPreview.valid) {
      setError('Cron expression is invalid.');
      return;
    }
    let params: Record<string, unknown> = {};
    try {
      params = paramsText.trim() ? JSON.parse(paramsText) : {};
    } catch {
      setError('Params must be valid JSON.');
      return;
    }

    setSaving(true);
      try {
        if (isEdit && schedule) {
        await updateSchedule(schedule.id, {
          name,
          description,
          cron,
          params,
          override,
          enabled,
        });
        notificationService.success('Schedule updated.');
      } else {
        await createSchedule({
          appId,
          jobType,
          scheduleKey,
          name,
          description,
          cron,
          params,
          override,
          enabled,
        });
        notificationService.success('Schedule created.');
      }
      onClose();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to save schedule';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const identityDisabled = isEdit;

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex justify-end bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-full w-[520px] flex-col bg-[var(--bg-primary)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {isEdit ? 'Edit Schedule' : 'Create Schedule'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly CRM sync" />
          </Field>

          <Field label="Description">
            <Input
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this scheduled job does."
            />
          </Field>

          <Field label="App" required>
            <Select
              value={appId}
              onChange={(v: string) => { setAppId(v); setJobType(''); }}
              disabled={identityDisabled}
              options={[
                { value: '', label: 'Select app…' },
                ...apps.map((a) => ({ value: a, label: a })),
              ]}
            />
          </Field>

          <Field label="Workload" required>
            <Select
              value={jobType}
              onChange={setJobType}
              disabled={identityDisabled || !appId}
              options={[
                { value: '', label: appId ? 'Select workload…' : 'Pick an app first' },
                ...workloadsForApp.map((w) => ({
                  value: w.jobType,
                  label: `${w.label} (${w.jobType})`,
                })),
              ]}
            />
            {selectedWorkload ? (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">{selectedWorkload.description}</p>
            ) : null}
          </Field>

          <Field label="Schedule key" required>
            <Input
              value={scheduleKey}
              onChange={(e) => setScheduleKey(e.target.value)}
              disabled={identityDisabled}
              placeholder="nightly-crm-sync"
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Stable identifier — unique per (app, workload). Cannot change after creation.
            </p>
          </Field>

          <Field label="Cron" required>
            <Input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 */6 * * *"
              className="font-mono"
            />
            <p
              className={cn(
                'mt-1 text-[11px]',
                cronPreview.valid ? 'text-[var(--text-muted)]' : 'text-[var(--color-danger)]',
              )}
            >
              {cronPreview.text}
            </p>
          </Field>

          <Field label={paramsFieldLabel}>
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={6}
              readOnly={!paramsAreEditable}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]"
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              {paramsFieldHint}
            </p>
          </Field>

          <div className="rounded-md border border-[var(--border-default)] p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Override config
            </h3>

            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">Skip criteria (OR)</span>
                <Button variant="secondary" size="sm" onClick={handleAddSkipCriterion} className="gap-1 px-2">
                  <Plus className="h-3 w-3" />
                  Add
                </Button>
              </div>
              {(override.skipCriteria ?? []).length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">No predicates — schedule fires whenever its cron is due.</p>
              ) : (
                <ul className="space-y-1">
                  {(override.skipCriteria ?? []).map((criterion, index) => (
                    <SkipCriterionRow
                      key={index}
                      criterion={criterion}
                      predicates={predicates}
                      onChange={(next) => handleChangeSkipCriterion(index, next)}
                      onRemove={() => handleRemoveSkipCriterion(index)}
                    />
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Field label="Retry count">
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={override.retryCount ?? 0}
                    onChange={(e) => setOverride((prev) => ({ ...prev, retryCount: Number(e.target.value) }))}
                  />
                </Field>
                <Field label="Retry interval (min)">
                  <Input
                    type="number"
                    min={1}
                    value={override.retryIntervalMinutes ?? 15}
                    onChange={(e) =>
                      setOverride((prev) => ({ ...prev, retryIntervalMinutes: Number(e.target.value) }))
                    }
                  />
                </Field>
              </div>

              <Field label="On exhaust">
                <Select
                  value={override.onExhaust ?? 'wait_next_tick'}
                  onChange={(v: string) => setOverride((prev) => ({ ...prev, onExhaust: v as 'wait_next_tick' }))}
                  options={onExhaustModes.map((m) => ({ value: m, label: m }))}
                />
              </Field>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--color-brand-accent)]"
            />
            Enabled
          </label>

          {error ? (
            <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
    </div>
  );
}

function SkipCriterionRow({
  criterion,
  predicates,
  onChange,
  onRemove,
}: {
  criterion: SkipCriterion;
  predicates: RegisteredPredicate[];
  onChange: (next: SkipCriterion) => void;
  onRemove: () => void;
}) {
  const selected = predicates.find((p) => p.id === criterion.type) ?? null;
  const argsPreview = JSON.stringify(
    Object.fromEntries(Object.entries(criterion).filter(([k]) => k !== 'type')),
    null,
    0,
  );

  const handleTypeChange = (newType: string) => {
    const predicate = predicates.find((p) => p.id === newType);
    onChange({ type: newType, ...(predicate ? defaultArgsFor(predicate) : {}) });
  };

  const handleArgsChange = (raw: string) => {
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      onChange({ type: criterion.type, ...parsed });
    } catch {
      // leave input raw for user to fix; don't propagate invalid JSON upward
    }
  };

  return (
    <li className="space-y-1 rounded-md border border-[var(--border-subtle)] p-2">
      <div className="flex items-center gap-2">
        <Select
          value={criterion.type}
          onChange={handleTypeChange}
          options={predicates.map((p) => ({ value: p.id, label: p.label }))}
          className="flex-1"
        />
        <button
          onClick={onRemove}
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)]"
          title="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Input
        value={argsPreview === '{}' ? '' : argsPreview}
        onChange={(e) => handleArgsChange(e.target.value)}
        placeholder='{"scope":"tenant_app"}'
        className="font-mono"
      />
      {selected ? (
        <p className="text-[11px] text-[var(--text-muted)]">{selected.description}</p>
      ) : null}
    </li>
  );
}
