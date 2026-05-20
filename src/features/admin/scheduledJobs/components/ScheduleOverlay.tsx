import { useEffect, useId, useMemo, useRef, useState } from 'react';
import cronstrue from 'cronstrue';
import { Plus, X } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Input,
  RightSlideOverShell,
  Select,
} from '@/components/ui';
import { useScheduledJobsStore } from '@/stores/scheduledJobsStore';
import { notificationService } from '@/services/notifications';
import { cn } from '@/utils';
import type {
  RegisteredPredicate,
  Schedule,
  ScheduleOverride,
  SkipCriterion,
} from '../types';
import { NotifyOnFailureSection } from './NotifyOnFailureSection';
import { useAuthStore } from '@/stores/authStore';
import { adminApi } from '@/services/api/adminApi';

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
  const titleId = useId();
  const loadRegistry = useScheduledJobsStore((state) => state.loadRegistry);
  const registry = useScheduledJobsStore((state) => state.registry);
  const createSchedule = useScheduledJobsStore((state) => state.create);
  const updateSchedule = useScheduledJobsStore((state) => state.update);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

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
  const [notifyOwnerOnFailure, setNotifyOwnerOnFailure] = useState(
    schedule?.notifyOwnerOnFailure ?? false,
  );
  const [notifyEmailsOnFailure, setNotifyEmailsOnFailure] = useState<string[]>(
    schedule?.notifyEmailsOnFailure ?? [],
  );
  const sessionEmail = useAuthStore((s) => s.user?.email ?? null);
  // Existing schedules carry a snapshot of the creator's email; new
  // schedules read it from the signed-in session so the owner-checkbox
  // has a recipient on first save.
  const ownerEmail = schedule?.createdByUserEmailSnapshot ?? sessionEmail;
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void adminApi
      .getTenantConfig()
      .then((cfg) => {
        if (!cancelled) setAllowedDomains(cfg.allowedDomains ?? []);
      })
      .catch(() => {
        // Domain hint is informational; failing silent is acceptable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Snapshot the initial form shape so a dirty-state gate can compare
  // against the current field values. A single JSON-serialized baseline
  // keeps this cheap and avoids a per-field change-tracking layer.
  const baselineRef = useRef<string>(
    JSON.stringify({
      name: schedule?.name ?? '',
      description: schedule?.description ?? '',
      appId: schedule?.appId ?? '',
      jobType: schedule?.jobType ?? '',
      scheduleKey: schedule?.scheduleKey ?? '',
      cron: schedule?.cron ?? '0 */6 * * *',
      paramsText: JSON.stringify(schedule?.params ?? {}, null, 2),
      override: schedule?.override ?? {
        skipCriteria: [],
        retryCount: 0,
        retryIntervalMinutes: 15,
        onExhaust: 'wait_next_tick',
      },
      enabled: schedule?.enabled ?? true,
      notifyOwnerOnFailure: schedule?.notifyOwnerOnFailure ?? false,
      notifyEmailsOnFailure: schedule?.notifyEmailsOnFailure ?? [],
    }),
  );
  const currentSnapshot = JSON.stringify({
    name,
    description: description ?? '',
    appId,
    jobType,
    scheduleKey,
    cron,
    paramsText,
    override,
    enabled,
    notifyOwnerOnFailure,
    notifyEmailsOnFailure,
  });
  const isDirty = currentSnapshot !== baselineRef.current;

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

  // Required-field gate so the Save button is only enabled when a valid
  // payload can be built. Backend still validates, but pydantic 422s here
  // are a bad UX — we want a clear inline message instead.
  const missingFields: string[] = [];
  if (!name.trim()) missingFields.push('Name');
  if (!isEdit && !appId) missingFields.push('App');
  if (!isEdit && !jobType) missingFields.push('Workload');
  if (!isEdit && !scheduleKey.trim()) missingFields.push('Schedule key');
  if (!cron.trim()) missingFields.push('Cron');
  const canSave = missingFields.length === 0 && cronPreview.valid && !saving;

  const handleSave = async () => {
    setError(null);
    if (missingFields.length > 0) {
      setError(`Missing required fields: ${missingFields.join(', ')}.`);
      return;
    }
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
          notifyOwnerOnFailure,
          notifyEmailsOnFailure,
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
          notifyOwnerOnFailure,
          notifyEmailsOnFailure,
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

  // Close intent goes through the dirty-state gate. Escape and backdrop
  // both route here via RightSlideOverShell; they can't skip the guard.
  const handleCloseIntent = () => {
    if (saving) return;
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    onClose();
  };

  return (
    <RightSlideOverShell
      isOpen={true}
      onClose={handleCloseIntent}
      onEscape={handleCloseIntent}
      labelledBy={titleId}
      widthClassName="w-[520px] max-w-[92vw]"
      panelClassName="bg-[var(--bg-primary)]"
      closeOnBackdropClick={!saving}
    >
      <div className="flex h-full w-full flex-col">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">
              {isEdit ? 'Edit Schedule' : 'Create Schedule'}
            </h2>
            {isDirty ? (
              <span
                className="rounded-full bg-[var(--color-warning)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-warning)]"
                title="You have unsaved changes"
              >
                Unsaved
              </span>
            ) : null}
          </div>
          <button
            onClick={handleCloseIntent}
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
              placeholder="Select app…"
              options={apps.map((a) => ({ value: a, label: a }))}
            />
          </Field>

          <Field label="Workload" required>
            <Select
              value={jobType}
              onChange={setJobType}
              disabled={identityDisabled || !appId}
              placeholder={appId ? 'Select workload…' : 'Pick an app first'}
              options={workloadsForApp.map((w) => ({
                value: w.jobType,
                label: `${w.label} (${w.jobType})`,
              }))}
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

          <NotifyOnFailureSection
            notifyOwnerOnFailure={notifyOwnerOnFailure}
            notifyEmailsOnFailure={notifyEmailsOnFailure}
            ownerEmail={ownerEmail}
            allowedDomains={allowedDomains}
            onChange={(next) => {
              setNotifyOwnerOnFailure(next.notifyOwnerOnFailure);
              setNotifyEmailsOnFailure(next.notifyEmailsOnFailure);
            }}
          />


          {error ? (
            <div className="rounded-md border border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-5 py-3">
          <Button variant="secondary" onClick={handleCloseIntent} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </footer>
      </div>

      <ConfirmDialog
        isOpen={confirmDiscardOpen}
        title="Discard unsaved changes?"
        description="You have unsaved changes to this schedule. Close anyway and lose them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="warning"
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onClose();
        }}
        onClose={() => setConfirmDiscardOpen(false)}
      />
    </RightSlideOverShell>
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
