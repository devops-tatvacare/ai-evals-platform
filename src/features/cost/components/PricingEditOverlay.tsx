import { useMemo, useState } from 'react';
import { Input } from '@/components/ui';
import { SettingsSlideOver } from '@/features/settings/components/SettingsSlideOver';
import { useCostStore } from '@/stores/costStore';
import { notificationService } from '@/services/notifications';
import type { PricingRow } from '../types';

interface PricingEditOverlayProps {
  mode: 'create' | 'patch';
  pricing?: PricingRow;
  onClose: () => void;
}

type FieldKey =
  | 'inputPer1MUsd'
  | 'outputPer1MUsd'
  | 'cachedReadPer1MUsd'
  | 'cacheWrite5MPer1MUsd'
  | 'cacheWrite1HPer1MUsd'
  | 'reasoningPer1MUsd';

const NUMERIC_FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'inputPer1MUsd', label: 'Input $/1M' },
  { key: 'outputPer1MUsd', label: 'Output $/1M' },
  { key: 'cachedReadPer1MUsd', label: 'Cached read $/1M' },
  { key: 'cacheWrite5MPer1MUsd', label: 'Cache write 5m $/1M' },
  { key: 'cacheWrite1HPer1MUsd', label: 'Cache write 1h $/1M' },
  { key: 'reasoningPer1MUsd', label: 'Reasoning $/1M' },
];

export function PricingEditOverlay({ mode, pricing, onClose }: PricingEditOverlayProps) {
  const createPricing = useCostStore((s) => s.createPricing);
  const patchPricing = useCostStore((s) => s.patchPricing);

  const initialProvider = pricing?.provider ?? '';
  const initialModel = pricing?.model ?? '';
  const initialNotes = pricing?.notes ?? '';
  const initialRates = useMemo(
    () =>
      Object.fromEntries(
        NUMERIC_FIELDS.map((field) => [field.key, pricing ? String(pricing[field.key] ?? 0) : '0']),
      ) as Record<FieldKey, string>,
    [pricing],
  );

  const [submitting, setSubmitting] = useState(false);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [notes, setNotes] = useState(initialNotes);
  const [rates, setRates] = useState<Record<FieldKey, string>>(initialRates);

  const title = useMemo(
    () => (mode === 'create' ? 'New pricing row' : `Edit pricing — ${pricing?.provider}/${pricing?.model}`),
    [mode, pricing],
  );
  const description = mode === 'create'
    ? 'Create a new effective-dated pricing row. If a live row already exists for this provider/model, it will be closed automatically.'
    : 'Save creates a successor pricing row effective now. Historical rows stay intact for reproducible cost reporting.';
  const isDirty =
    provider !== initialProvider
    || model !== initialModel
    || notes !== initialNotes
    || NUMERIC_FIELDS.some((field) => rates[field.key] !== initialRates[field.key]);
  const canSubmit = mode === 'patch' || (provider.trim().length > 0 && model.trim().length > 0);

  const updateRate = (key: FieldKey, value: string) =>
    setRates((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const numericPayload: Record<FieldKey, number> = Object.fromEntries(
      NUMERIC_FIELDS.map((f) => [f.key, parseFloat(rates[f.key] || '0') || 0]),
    ) as Record<FieldKey, number>;

    if (Object.values(numericPayload).some((v) => v < 0)) {
      notificationService.error('Rates must be non-negative.');
      return;
    }
    if (mode === 'create' && (!provider.trim() || !model.trim())) {
      notificationService.error('Provider and model are required.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createPricing({
          provider: provider.trim(),
          model: model.trim(),
          notes: notes.trim() || null,
          ...numericPayload,
        });
      } else if (pricing) {
        await patchPricing(pricing.id, {
          notes: notes.trim() || null,
          ...numericPayload,
        });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      notificationService.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsSlideOver
      isOpen
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={mode === 'create' ? 'Create row' : 'Save row'}
      canSubmit={canSubmit}
      isSubmitting={submitting}
      isDirty={isDirty}
      widthClassName="w-[560px] max-w-full"
      footerContent={(
        <div className="text-[12px] text-[var(--text-muted)]">
          Pricing remains effective-dated. Saving inserts a new active row and preserves historical cost reproducibility.
        </div>
      )}
    >
      <div className="space-y-5">
        <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Model identity</h3>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                {mode === 'create'
                  ? 'Pick the provider/model pair this pricing row applies to.'
                  : 'Provider and model stay fixed while you create a successor row.'}
              </p>
            </div>
          </div>
          {mode === 'create' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledField label="Provider">
                <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="openai" />
              </LabeledField>
              <LabeledField label="Model">
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />
              </LabeledField>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <StaticField label="Provider" value={pricing?.provider ?? '—'} />
              <StaticField label="Model" value={pricing?.model ?? '—'} mono />
            </div>
          )}
        </section>

        <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-3">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Token pricing</h3>
            <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
              Enter USD rates per 1M tokens. Leave unsupported fields at <span className="font-mono">0</span>.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {NUMERIC_FIELDS.map((field) => (
              <LabeledField key={field.key} label={field.label}>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={rates[field.key]}
                  onChange={(e) => updateRate(field.key, e.target.value)}
                />
              </LabeledField>
            ))}
          </div>
        </section>

        <section className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <LabeledField label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contract-negotiated, promo pricing, source notes..."
              rows={4}
              className="w-full rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50"
            />
          </LabeledField>
        </section>
      </div>
    </SettingsSlideOver>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function StaticField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <div className="rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)]">
        <span className={mono ? 'font-mono text-[13px]' : undefined}>{value}</span>
      </div>
    </div>
  );
}
