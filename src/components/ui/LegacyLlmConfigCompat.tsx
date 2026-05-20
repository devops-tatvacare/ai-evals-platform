import { useMemo } from 'react';

import { LlmModelSelect, type LlmModelSelectValue } from '@/components/ui/LlmModelSelect';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import type { LlmProvider } from '@/services/api/llmCredentialsApi';
import { useAllTenantCredentials } from '@/services/api/llmCredentialsQueries';

interface LegacyLlmConfigCompatProps {
  /** Call site this picker maps to. */
  callSite: string;
  provider: LLMProvider | '';
  onProviderChange: (p: LLMProvider) => void;
  model: string;
  onModelChange: (m: string) => void;
  compact?: boolean;
  layout?: 'stack' | 'rows';
}

/**
 * Drop-in replacement for `<LLMConfigSection>` that wraps `<LlmModelSelect>`
 * but exposes the old `(provider, model)` setter pair. Lets us land Phase 3
 * without rewriting every overlay's job-submit shape in the same commit.
 *
 * Resolves the credentialId by matching the caller's `provider` against the
 * tenant's enabled credentials (preferring `name='default'`). When `provider`
 * + `model` are both absent we render `value={null}` so LlmModelSelect's
 * auto-prefill fires from `tenant_call_site_defaults`. When the tenant has
 * no credentials at all, LlmModelSelect renders its own empty-state hint.
 */
export function LegacyLlmConfigCompat({
  callSite,
  provider,
  onProviderChange,
  model,
  onModelChange,
  compact,
  layout,
}: LegacyLlmConfigCompatProps) {
  const { credentials } = useAllTenantCredentials();

  const pick: LlmModelSelectValue | null = useMemo(() => {
    if (!provider && !model) return null;
    if (!provider) return null;
    const matches = credentials.filter(
      (c) => c.provider === (provider as LlmProvider) && c.isEnabled,
    );
    if (matches.length === 0) return null;
    const chosen = matches.find((c) => c.name === 'default') ?? matches[0];
    return {
      credentialId: chosen.id,
      provider: chosen.provider,
      credentialName: chosen.name,
      model,
    };
  }, [provider, model, credentials]);

  const handleChange = (next: LlmModelSelectValue | null) => {
    if (!next) {
      onProviderChange('' as LLMProvider);
      onModelChange('');
      return;
    }
    if (next.provider !== provider) onProviderChange(next.provider as LLMProvider);
    if (next.model !== model) onModelChange(next.model);
  };

  return (
    <LlmModelSelect
      callSite={callSite}
      value={pick}
      onChange={handleChange}
      compact={compact}
      layout={layout}
    />
  );
}
