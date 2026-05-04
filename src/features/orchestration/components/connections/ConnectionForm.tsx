import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
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

import {
  DynamicConfigForm,
  type JsonSchema,
} from '../DynamicConfigForm';

interface Props {
  appId: string;
  /** When set, the form is in edit mode for that connection — provider is
   *  locked, secret fields render with "leave blank to keep" semantics. */
  existing?: Connection | null;
  onClose(): void;
  onSaved(connection: Connection): void;
}

const PROVIDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'bolna', label: 'Bolna (AI Voice)' },
  { value: 'wati', label: 'WATI (WhatsApp)' },
  { value: 'aisensy', label: 'AiSensy (WhatsApp)' },
  { value: 'lsq', label: 'LeadSquared' },
  { value: 'msg91', label: 'MSG91 (SMS)' },
  { value: 'webhook', label: 'Generic Webhook' },
];

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
      out[k] = v as string[];
    }
  }
  return out;
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
        });
      } else {
        saved = await createConnection({
          appId,
          provider,
          name,
          config: payloadConfig,
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
          options={PROVIDER_OPTIONS}
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
      {jsonSchema ? (
        <DynamicConfigForm
          schema={jsonSchema}
          value={config}
          onChange={setConfig}
          appId={appId}
          secretsOptional={isEdit}
        />
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
        <Button onClick={handleSave} disabled={saving || !name || !schema}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
