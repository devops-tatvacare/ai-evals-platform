import { useMemo, useState } from 'react';

/**
 * Derived dirty detection: compare the local form to the TanStack-cached
 * snapshot. No store, no boolean flag — `useLifecycleState`-style derived
 * pattern from `CLAUDE.md` (orchestration Phase 14 invariant).
 *
 * Rules:
 * - apiKey is write-only on the wire; any non-empty value means "rotate".
 * - Azure carries an api_version field that lives in `extra_config`.
 * - curatedModels compares by sequence (order matters — admin chose it).
 */
function computeIsDirty(
  form: PanelFormState,
  config: ProviderConfig | undefined,
  isAzure: boolean,
): boolean {
  if (form.apiKey !== '') return true;
  const snapshot = hydrateForm(config);
  if (form.isEnabled !== snapshot.isEnabled) return true;
  if (form.baseUrl !== snapshot.baseUrl) return true;
  if (isAzure && form.apiVersion !== snapshot.apiVersion) return true;
  if (form.curatedModels.length !== snapshot.curatedModels.length) return true;
  for (let i = 0; i < form.curatedModels.length; i += 1) {
    if (form.curatedModels[i] !== snapshot.curatedModels[i]) return true;
  }
  return false;
}
import { CheckCircle2, Eye, EyeOff, Save, ShieldAlert } from 'lucide-react';
import { cn } from '@/utils';

import { Badge, Button, Input, Switch } from '@/components/ui';
import type { LLMProvider, ProviderConfig } from '@/services/api/aiSettingsApi';
import {
  useProviderConfigs,
  useUpsertProvider,
  useValidateProvider,
} from '@/services/api/aiSettingsQueries';
import { notificationService } from '@/services/notifications/notificationService';

import { ModelCuration } from './ModelCuration';
import { ProviderLogo } from './ProviderLogo';

interface ProviderConfigPanelProps {
  provider: LLMProvider;
}

const DEFAULT_AZURE_API_VERSION = '2025-04-01-preview';

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: 'OpenAI',
  azure_openai: 'Azure OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

interface PanelFormState {
  isEnabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiVersion: string;
  curatedModels: string[];
}

function hydrateForm(config: ProviderConfig | undefined): PanelFormState {
  return {
    isEnabled: config?.isEnabled ?? false,
    apiKey: '',
    baseUrl: config?.baseUrl ?? '',
    apiVersion:
      (config?.extraConfig?.api_version as string | undefined) ??
      DEFAULT_AZURE_API_VERSION,
    curatedModels: config?.curatedModels ?? [],
  };
}

function PanelInner({
  provider,
  config,
}: {
  provider: LLMProvider;
  config: ProviderConfig | undefined;
}) {
  const [form, setForm] = useState<PanelFormState>(() => hydrateForm(config));
  const [showKey, setShowKey] = useState(false);
  const upsert = useUpsertProvider();
  const validate = useValidateProvider();

  const isAzure = provider === 'azure_openai';
  const hasStoredKey = Boolean(config?.hasApiKey);
  const isDirty = useMemo(
    () => computeIsDirty(form, config, isAzure),
    [form, config, isAzure],
  );

  const handleSave = async () => {
    try {
      const extraConfig: Record<string, unknown> = {
        ...(config?.extraConfig ?? {}),
      };
      if (isAzure) {
        extraConfig.api_version = form.apiVersion || DEFAULT_AZURE_API_VERSION;
        // Mirror curated deployment names into extra_config.deployments so
        // legacy runner code that reads either side keeps working until the
        // Phase-3 cleanup picks one source of truth.
        extraConfig.deployments = [...form.curatedModels];
      }
      await upsert.mutateAsync({
        provider,
        body: {
          isEnabled: form.isEnabled,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl ? form.baseUrl : null,
          extraConfig,
          curatedModels: form.curatedModels,
        },
      });
      notificationService.success(`${PROVIDER_LABELS[provider]} settings saved.`);
      setForm((prev) => ({ ...prev, apiKey: '' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      notificationService.error(message);
    }
  };

  const handleValidate = async () => {
    try {
      const result = await validate.mutateAsync(provider);
      if (result.validationStatus === 'ok') {
        notificationService.success('Credentials validated.');
      } else {
        notificationService.warning(
          result.detail
            ? `Validation failed: ${result.detail}`
            : 'Validation failed.',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed.';
      notificationService.error(message);
    }
  };

  const statusBadge = (() => {
    if (!config) return null;
    if (!config.isEnabled) {
      return <Badge variant="neutral">Disabled</Badge>;
    }
    if (!config.hasApiKey) {
      return <Badge variant="warning">No API key</Badge>;
    }
    if (config.validationStatus === 'ok') {
      return (
        <Badge variant="success" icon={CheckCircle2}>
          Validated
        </Badge>
      );
    }
    if (config.validationStatus === 'invalid') {
      return (
        <Badge variant="danger" icon={ShieldAlert}>
          Invalid
        </Badge>
      );
    }
    return <Badge variant="neutral">Untested</Badge>;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-dashed border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-3">
          <ProviderLogo provider={provider} size={28} />
          <div className="flex flex-col">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {PROVIDER_LABELS[provider]}
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              API credentials and curated model list for this tenant.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {statusBadge}
          <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            Enabled
            <Switch
              checked={form.isEnabled}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isEnabled: checked }))
              }
            />
          </label>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-4 pr-1">
        <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
            API Key
          </span>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, apiKey: e.target.value }))
                }
                placeholder={
                  config?.apiKeyPreview ?? 'Paste API key'
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {form.apiKey !== '' && (
              <Button
                type="button"
                variant="ghost"
                size="md"
                icon={showKey ? EyeOff : Eye}
                iconOnly
                aria-label={showKey ? 'Hide entered key' : 'Show entered key'}
                onClick={() => setShowKey((s) => !s)}
              />
            )}
          </div>
          {hasStoredKey && form.apiKey === '' && config?.apiKeyPreview && (
            <p className="text-[11px] text-[var(--text-secondary)]">
              Stored value:{' '}
              <span className={cn('font-mono text-[var(--text-primary)]')}>
                {config.apiKeyPreview}
              </span>
              {' · leave blank to keep, type to rotate.'}
            </p>
          )}
          {!hasStoredKey && (
            <p className="text-[11px] text-[var(--text-secondary)]">
              The key is encrypted at rest and never returned to the browser.
            </p>
          )}
        </label>

        {isAzure && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                Azure Endpoint
              </span>
              <Input
                value={form.baseUrl}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
                placeholder="https://your-resource.openai.azure.com"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
                API Version
              </span>
              <Input
                value={form.apiVersion}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, apiVersion: e.target.value }))
                }
                placeholder={DEFAULT_AZURE_API_VERSION}
              />
            </label>
          </>
        )}
      </section>

        <ModelCuration
          provider={provider}
          curatedModels={form.curatedModels}
          onChange={(models) =>
            setForm((prev) => ({ ...prev, curatedModels: models }))
          }
          disabled={!hasStoredKey && !form.apiKey}
        />
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] pt-3">
        <Button
          type="button"
          variant="secondary"
          onClick={handleValidate}
          disabled={!hasStoredKey || validate.isPending}
          isLoading={validate.isPending}
        >
          Test connection
        </Button>
        {isDirty && (
          <Button
            type="button"
            variant="primary"
            icon={Save}
            onClick={handleSave}
            isLoading={upsert.isPending}
            disabled={upsert.isPending}
          >
            Save changes
          </Button>
        )}
      </footer>
    </div>
  );
}

export function ProviderConfigPanel({ provider }: ProviderConfigPanelProps) {
  const { data } = useProviderConfigs();
  const config = useMemo(
    () => data?.find((p) => p.provider === provider),
    [data, provider],
  );
  // Remount on provider change so `useState` re-seeds from the snapshot
  // without an effect-driven `setState`. Save/validate succeed by relying on
  // the cached snapshot through TQ invalidation; the form holds local edits.
  return <PanelInner key={provider} provider={provider} config={config} />;
}
