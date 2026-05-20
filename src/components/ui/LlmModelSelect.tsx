import { useEffect, useMemo } from 'react';

import { Combobox } from '@/components/ui/Combobox';
import { CapabilityChips } from '@/components/ui/CapabilityChip';
import { LLMProviderLogo } from '@/components/ui/LLMProviderLogo';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import {
  useAllTenantCredentials,
} from '@/services/api/llmCredentialsQueries';
import { useLlmModels } from '@/services/api/llmModelsQueries';
import { useTenantCallSiteDefaults } from '@/services/api/llmCallSiteDefaultsQueries';
import type { LlmProvider, TenantCredential } from '@/services/api/llmCredentialsApi';
import { cn } from '@/utils';

export interface LlmModelSelectValue {
  credentialId: string;
  provider: LlmProvider;
  credentialName: string;
  model: string;
}

interface LlmModelSelectProps {
  callSite: string;
  value: LlmModelSelectValue | null;
  onChange: (value: LlmModelSelectValue | null) => void;
  /** Restrict the credential list to a single provider (e.g. force OpenAI for audio_transcription). */
  providerFilter?: LlmProvider;
  /** When true, do not auto-prefill from the tenant's call-site default. */
  noAutoDefault?: boolean;
  disabled?: boolean;
  compact?: boolean;
  /**
   * - `stack` (default) — two stacked comboboxes with optional labels above.
   * - `rows` — labelled grid; label column + control column per row.
   * - `inline` — credential + model side-by-side on a single row, no labels.
   *   Use inside tight table rows where the surrounding row carries the title.
   */
  layout?: 'stack' | 'rows' | 'inline';
}

/**
 * Two-row credential+model picker fed by `tenant_llm_credentials` and the
 * capability-filtered `/api/llm/models` endpoint. Replaces `LLMConfigSection`.
 *
 * - Credentials enumerate enabled tenant rows across every supported provider.
 * - Models are gated server-side by the call site's required capabilities.
 * - Default value pre-fills from `tenant_call_site_defaults` (tenant row,
 *   falling back to the platform row).
 */
export function LlmModelSelect({
  callSite,
  value,
  onChange,
  providerFilter,
  noAutoDefault = false,
  disabled = false,
  compact = false,
  layout = 'stack',
}: LlmModelSelectProps) {
  const { credentials, isLoading: credsLoading } = useAllTenantCredentials();
  const { data: defaults = [] } = useTenantCallSiteDefaults();

  const filteredCreds = useMemo(
    () =>
      credentials.filter(
        (c) =>
          c.isEnabled && (!providerFilter || c.provider === providerFilter),
      ),
    [credentials, providerFilter],
  );

  // Resolve the default for this call site once credentials load.
  useEffect(() => {
    if (noAutoDefault || value || credsLoading) return;
    const def = defaults.find((d) => d.callSite === callSite);
    if (!def) return;
    const match = filteredCreds.find(
      (c) => c.provider === def.provider && c.name === def.credentialName,
    );
    if (!match) return;
    onChange({
      credentialId: match.id,
      provider: match.provider,
      credentialName: match.name,
      model: def.modelOrDeployment,
    });
  }, [
    noAutoDefault,
    value,
    credsLoading,
    defaults,
    callSite,
    filteredCreds,
    onChange,
  ]);

  const { data: modelOptions = [], isLoading: modelsLoading } = useLlmModels(
    callSite,
    value?.credentialId ?? null,
  );

  if (!credsLoading && filteredCreds.length === 0) {
    return (
      <EmptyHint
        compact={compact}
        message={
          providerFilter
            ? `No ${LLM_PROVIDER_LABELS[providerFilter]} credential configured. Ask an admin to add one in /admin/llm/providers.`
            : 'No LLM provider configured. Ask an admin to add one in /admin/llm/providers.'
        }
      />
    );
  }

  const credentialOptions = filteredCreds.map((c) => ({
    value: c.id,
    label: credentialLabel(c),
    leading: <LLMProviderLogo provider={c.provider} size={16} />,
  }));
  const handleCredentialChange = (credentialId: string) => {
    const next = filteredCreds.find((c) => c.id === credentialId);
    if (!next) {
      onChange(null);
      return;
    }
    onChange({
      credentialId: next.id,
      provider: next.provider,
      credentialName: next.name,
      model: '', // user must pick a fresh model for the new credential
    });
  };

  const modelComboOptions = modelOptions.map((m) => ({
    value: m.modelOrDeployment,
    // When the catalog has a display name distinct from the deployment/model
    // id, show the id as the dim search-friendly subtext so the user can
    // still scan by exact string. The capability chips render below.
    label: m.displayName || m.modelOrDeployment,
    meta:
      m.displayName && m.displayName !== m.modelOrDeployment
        ? m.modelOrDeployment
        : m.isDefaultForCallSite
          ? 'default'
          : undefined,
    description: <CapabilityChips tags={m.capabilities} />,
  }));

  const handleModelChange = (model: string) => {
    if (!value) return;
    onChange({ ...value, model });
  };

  const modelPlaceholder = !value
    ? 'Pick provider first'
    : modelsLoading
      ? 'Loading models…'
      : modelOptions.length === 0
        ? 'No models added for this provider — add them in Model Providers'
        : 'Select model';

  const credentialField = (
    <Combobox
      value={value?.credentialId ?? ''}
      options={credentialOptions}
      placeholder="Select provider"
      disabled={disabled || credsLoading || filteredCreds.length === 0}
      onChange={handleCredentialChange}
    />
  );

  const modelField = (
    <Combobox
      value={value?.model ?? ''}
      options={modelComboOptions}
      placeholder={modelPlaceholder}
      disabled={
        disabled || !value || modelsLoading || modelOptions.length === 0
      }
      onChange={handleModelChange}
    />
  );

  // Capability chip strip under the model row — shows the picked model's
  // declared capabilities so the user can see at a glance what the call site
  // is going to do.
  const pickedModel = value
    ? modelOptions.find((m) => m.modelOrDeployment === value.model)
    : null;

  if (layout === 'rows') {
    return (
      <div className="space-y-3">
        <Field label="Provider">{credentialField}</Field>
        <Field label="Model">
          {modelField}
          {pickedModel && (
            <div className="mt-1.5">
              <CapabilityChips tags={pickedModel.capabilities} />
            </div>
          )}
        </Field>
      </div>
    );
  }

  if (layout === 'inline') {
    // Model side gets the wider track because catalog deployment ids
    // (``gemini-2.5-flash-preview-09-2025``, ``ai-evals-gpt-5-4-mini``)
    // are routinely longer than the provider+credential label.
    return (
      <div className="grid grid-cols-[minmax(160px,1fr)_minmax(220px,1.6fr)] gap-2">
        <div className="min-w-0">{credentialField}</div>
        <div className="min-w-0">{modelField}</div>
      </div>
    );
  }

  return (
    <div className={cn(compact ? 'space-y-2' : 'space-y-3')}>
      <div>
        {!compact && (
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-primary)]">
            Provider
          </label>
        )}
        {credentialField}
      </div>
      <div>
        {!compact && (
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-primary)]">
            Model
          </label>
        )}
        {modelField}
        {pickedModel && (
          <div className="mt-1.5">
            <CapabilityChips tags={pickedModel.capabilities} />
          </div>
        )}
      </div>
    </div>
  );
}

function credentialLabel(c: TenantCredential): string {
  return `${LLM_PROVIDER_LABELS[c.provider]} · ${c.name}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] md:gap-4">
      <label className="text-[13px] font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <div>{children}</div>
    </div>
  );
}

function EmptyHint({
  compact,
  message,
}: {
  compact?: boolean;
  message: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]',
        compact ? 'p-2.5 text-[12px]' : 'p-3 text-[13px]',
        'text-[var(--text-secondary)]',
      )}
    >
      {message}
    </div>
  );
}
