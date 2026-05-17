import { useMemo } from 'react';

import { Select } from '@/components/ui/Select';
import { LLMProviderLogo } from '@/components/ui/LLMProviderLogo';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { cn } from '@/utils';

interface LLMConfigSectionProps {
  provider: LLMProvider | '';
  onProviderChange: (p: LLMProvider) => void;
  model: string;
  onModelChange: (m: string) => void;
  compact?: boolean;
  layout?: 'stack' | 'rows';
  /** Open the dropdowns upward when the section sits near the bottom of a
   *  modal/peek panel. Forwarded as Radix `side` to both `<Select>`s. */
  dropdownDirection?: 'up' | 'down';
}

/**
 * Two-row provider+model picker fed by admin AI-Settings.
 *
 * Provider options = providers the admin marked enabled and validated.
 * Model options = the chosen provider's curated_models. No API key, no
 * thinking, no on-the-wire discovery: credentials live server-side and
 * resolve through resolve_llm_credentials.
 */
export function LLMConfigSection({
  provider,
  onProviderChange,
  model,
  onModelChange,
  compact = false,
  layout = 'stack',
  dropdownDirection = 'down',
}: LLMConfigSectionProps) {
  const { data: configs = [], isLoading } = useProviderConfigs();

  const available = useMemo(
    () => configs.filter((c) => c.isEnabled && c.validationStatus === 'ok'),
    [configs],
  );
  const models = useMemo(
    () => available.find((c) => c.provider === provider)?.curatedModels ?? [],
    [available, provider],
  );
  const side: 'top' | 'bottom' = dropdownDirection === 'up' ? 'top' : 'bottom';
  const providerOptions = useMemo(
    () => available.map((c) => ({
      value: c.provider,
      label: LLM_PROVIDER_LABELS[c.provider],
      leading: <LLMProviderLogo provider={c.provider} size={18} />,
    })),
    [available],
  );
  const modelOptions = useMemo(
    () => models.map((m) => ({
      value: m,
      label: m,
      leading: provider ? <LLMProviderLogo provider={provider} size={18} /> : undefined,
    })),
    [models, provider],
  );

  if (!isLoading && available.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)]',
          compact ? 'p-2.5 text-[12px]' : 'p-3 text-[13px]',
          'text-[var(--text-secondary)]',
        )}
      >
        No LLM provider configured. An admin must set one up in AI Settings.
      </div>
    );
  }

  const providerSelect = (
    <Select
      value={provider}
      disabled={isLoading || available.length === 0}
      options={providerOptions}
      placeholder="Select provider"
      side={side}
      onChange={(value) => {
        onModelChange('');
        onProviderChange(value as LLMProvider);
      }}
    />
  );

  const modelSelect = (
    <Select
      value={model}
      disabled={isLoading || !provider || models.length === 0}
      options={modelOptions}
      placeholder={
        !provider
          ? 'Choose a provider first'
          : models.length === 0
            ? 'No curated models'
            : 'Select model'
      }
      side={side}
      onChange={onModelChange}
    />
  );

  if (layout === 'rows') {
    return (
      <div className="space-y-4">
        <div className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] md:gap-4">
          <label className="text-[13px] font-medium text-[var(--text-primary)]">
            Provider
          </label>
          {providerSelect}
        </div>
        <div className="grid items-start gap-2.5 md:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] md:gap-4">
          <label className="text-[13px] font-medium text-[var(--text-primary)]">
            Model
          </label>
          {modelSelect}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(compact ? 'space-y-2.5' : 'space-y-4')}>
      <div>
        {!compact && (
          <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
            Provider
          </label>
        )}
        {providerSelect}
      </div>

      <div>
        {!compact && (
          <label className="mb-1.5 block text-[12px] font-medium text-[var(--text-primary)]">
            Model
          </label>
        )}
        {modelSelect}
      </div>
    </div>
  );
}
