import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { ApiError } from '@/services/api/client';
import {
  createConnection,
  getProviderSchema,
  updateConnection,
  type Connection,
  type ConnectionConfig,
  type ProviderSchema,
} from '@/services/api/orchestrationConnections';
import { notificationService } from '@/services/notifications';
import type { AssetVisibility } from '@/types/settings.types';

import {
  DynamicConfigForm,
  type JsonSchema,
} from '@/features/orchestration/components/DynamicConfigForm';
import {
  CONNECTION_PROVIDER_OPTIONS,
} from './providerOptions';

interface Props {
  appId: string;
  /** When set, the form is in edit mode for that connection — provider is
   *  locked, secret fields render with "leave blank to keep" semantics. */
  existing?: Connection | null;
  onClose(): void;
  onSaved(connection: Connection): void;
}

const E164_REGEX = /^\+\d{8,15}$/;

/** Drop `undefined` keys so the JSON payload doesn't carry blank-secret
 *  hints (the backend rejects empty secret strings; absent keys preserve
 *  stored values). String[] fields (e.g. WATI ``channel_numbers``) flow
 *  through unchanged. */
function stripUndefined(input: Record<string, unknown>): ConnectionConfig {
  const out: ConnectionConfig = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((item) => typeof item === 'string')) {
      out[k] = v.map((item) => item.trim()).filter(Boolean) as string[];
    }
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function ConnectionForm({ appId, existing, onClose, onSaved }: Props) {
  const isEdit = Boolean(existing);
  const [provider, setProvider] = useState<string>(
    existing?.provider ?? 'bolna',
  );
  const [name, setName] = useState<string>(existing?.name ?? '');
  const [schema, setSchema] = useState<ProviderSchema | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>(
    existing ? { ...existing.configRedacted } : {},
  );
  const [visibility, setVisibility] = useState<AssetVisibility>(
    existing?.visibility ?? 'private',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSchema(null);
    setError(null);
    getProviderSchema(provider)
      .then((res) => {
        if (!alive) return;
        setSchema(res);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load provider schema');
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  // When the operator switches provider in create mode the redacted
  // config from a prior provider becomes meaningless — reset.
  useEffect(() => {
    if (!isEdit) setConfig({});
  }, [provider, isEdit]);

  const jsonSchema = useMemo<JsonSchema | null>(
    () => (schema ? (schema.jsonSchema as unknown as JsonSchema) : null),
    [schema],
  );
  const channelNumbersField = useMemo(
    () => schema?.fields.find((field) => field.name === 'channel_numbers') ?? null,
    [schema],
  );
  const channelNumbers = useMemo(
    () => asStringArray(config.channel_numbers),
    [config],
  );
  const invalidChannelNumbers = channelNumbers.filter((value) => {
    const trimmed = value.trim();
    return trimmed !== '' && !E164_REGEX.test(trimmed);
  });

  function updateChannelNumber(index: number, nextValue: string) {
    setConfig((current) => {
      const next = asStringArray(current.channel_numbers);
      next[index] = nextValue;
      return { ...current, channel_numbers: next };
    });
  }

  function addChannelNumber() {
    setConfig((current) => ({
      ...current,
      channel_numbers: [...asStringArray(current.channel_numbers), ''],
    }));
  }

  function removeChannelNumber(index: number) {
    setConfig((current) => ({
      ...current,
      channel_numbers: asStringArray(current.channel_numbers).filter((_, i) => i !== index),
    }));
  }

  async function handleSave() {
    if (!schema) return;
    setSaving(true);
    setError(null);
    try {
      const payloadConfig = stripUndefined(config);
      let saved: Connection;
      if (existing) {
        saved = await updateConnection(existing.id, {
          name,
          config: payloadConfig,
          visibility,
        });
      } else {
        saved = await createConnection({
          appId,
          provider,
          name,
          config: payloadConfig,
          visibility,
        });
      }
      notificationService.success(
        isEdit ? 'Connection updated' : 'Connection created',
      );
      onSaved(saved);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to save connection';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          Provider
        </label>
        <Select
          value={provider}
          onChange={(next) => setProvider(next)}
          options={CONNECTION_PROVIDER_OPTIONS}
          placeholder="Select provider"
          disabled={isEdit}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          Name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. TatvaCare Bolna — Production"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          Visibility
        </label>
        <VisibilityToggle value={visibility} onChange={setVisibility} />
      </div>
      {jsonSchema ? (
        <>
          <DynamicConfigForm
            schema={jsonSchema}
            value={config}
            onChange={setConfig}
            appId={appId}
            secretsOptional={isEdit}
            secretPreviews={isEdit ? existing?.secretPreviews : undefined}
            hiddenFields={provider === 'wati' ? new Set(['channel_numbers']) : undefined}
          />
          {provider === 'wati' ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-default)] border border-[var(--border-default)] p-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  {channelNumbersField?.title || 'Channel Numbers'}
                </label>
                <p className="text-xs text-[var(--text-secondary)]">
                  {channelNumbersField?.description
                    || 'Add the WhatsApp sender numbers available on this WATI workspace.'}
                </p>
              </div>
              {channelNumbers.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  No channel numbers added yet.
                </p>
              ) : null}
              {channelNumbers.map((value, index) => {
                const trimmed = value.trim();
                const invalid = trimmed !== '' && !E164_REGEX.test(trimmed);
                return (
                  <div key={`${index}-${value}`} className="flex flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <Input
                        value={value}
                        onChange={(e) => updateChannelNumber(index, e.target.value)}
                        placeholder="+919999990000"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => removeChannelNumber(index)}
                      >
                        Remove
                      </Button>
                    </div>
                    {invalid ? (
                      <p className="text-xs text-[var(--color-error)]">
                        Must be E.164 — start with &quot;+&quot; followed by 8–15 digits.
                      </p>
                    ) : null}
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3">
                <Button variant="secondary" size="sm" onClick={addChannelNumber}>
                  Add channel number
                </Button>
                {invalidChannelNumbers.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)]">
                    Leave a row blank to drop it on save.
                  </p>
                ) : (
                  <p className="text-xs text-[var(--color-error)]">
                    Fix invalid numbers before saving.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-[var(--text-secondary)]">
          Loading provider fields…
        </p>
      )}
      {error ? (
        <p className="text-xs text-[var(--color-error)]">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !name || !schema || invalidChannelNumbers.length > 0}
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
