import { Key, Server, Info } from 'lucide-react';
import { providerIcons, providerLabels } from '@/components/ui/ModelBadge/providers';
import { ModelSelector } from './ModelSelector';
import { cn } from '@/utils';
import { useLLMSettingsStore } from '@/stores';
import type { LLMProvider } from '@/types';

/** Provider option config — data-driven, not hardcoded inline */
const PROVIDERS: { value: LLMProvider; icon: string; label: string; hasServiceAccount: boolean }[] = [
  { value: 'gemini', icon: providerIcons.gemini, label: providerLabels.gemini, hasServiceAccount: true },
  { value: 'openai', icon: providerIcons.openai, label: providerLabels.openai, hasServiceAccount: false },
];

const API_KEY_META: Record<LLMProvider, { placeholder: string; hint: string }> = {
  gemini: { placeholder: 'AI...', hint: 'Get your key from aistudio.google.com' },
  openai: { placeholder: 'sk-...', hint: 'Get your key from platform.openai.com' },
};

interface ProviderConfigCardProps {
  provider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  selectedModel: string;
  onChange: (key: string, value: unknown) => void;
}

function ServiceAccountStatus() {
  const saConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);
  const hasHydrated = useLLMSettingsStore((s) => s._hasHydrated);

  if (!hasHydrated) {
    return (
      <div className="flex items-start gap-2.5 rounded-[var(--radius-default)] p-3 text-[13px] bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Checking server configuration...</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-[var(--radius-default)] p-3 text-[13px]',
      saConfigured
        ? 'bg-[var(--color-success)]/5 text-[var(--text-secondary)]'
        : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
    )}>
      <Server className="h-4 w-4 shrink-0 mt-0.5" />
      <span>
        {saConfigured
          ? 'Service account configured. Background evaluation jobs use server credentials.'
          : 'No service account configured. Background jobs will use your API key.'}
      </span>
    </div>
  );
}

export function ProviderConfigCard({
  provider,
  geminiApiKey,
  openaiApiKey,
  selectedModel,
  onChange,
}: ProviderConfigCardProps) {
  const activeProvider = PROVIDERS.find((p) => p.value === provider)!;
  const activeApiKey = provider === 'openai' ? openaiApiKey : geminiApiKey;
  const apiKeyMeta = API_KEY_META[provider];

  const handleApiKeyChange = (value: string) => {
    const key = provider === 'openai' ? 'openaiApiKey' : 'geminiApiKey';
    onChange(key, value);
    onChange('apiKey', value);
  };

  return (
    <div className="space-y-5">
      {/* Provider selector — icon cards */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-2">
          Provider
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange('provider', p.value)}
              className={cn(
                'flex items-center gap-3 rounded-[var(--radius-default)] border px-4 py-3 text-left transition-all',
                provider === p.value
                  ? 'border-[var(--border-brand)] bg-[var(--color-brand-accent)]/8 shadow-sm'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)]'
              )}
            >
              <img src={p.icon} alt={p.label} className="h-5 w-5 shrink-0" />
              <span className={cn(
                'text-[13px] font-medium',
                provider === p.value ? 'text-[var(--text-brand)]' : 'text-[var(--text-primary)]'
              )}>
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* API key input — always visible */}
      <div>
        <label className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          <Key className="h-3.5 w-3.5" />
          API Key
        </label>
        <input
          type="password"
          value={activeApiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          placeholder={apiKeyMeta.placeholder}
          className={cn(
            'w-full px-3 py-2 rounded-[var(--radius-default)] border border-[var(--border-default)]',
            'bg-[var(--input-bg)] text-[var(--text-primary)] text-[13px]',
            'placeholder:text-[var(--text-muted)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--border-brand)]/30 focus:border-[var(--border-focus)]',
          )}
        />
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          {apiKeyMeta.hint}. Used for AI-assist features (prompt & schema generation).
        </p>
      </div>

      {/* Service Account status — Gemini only */}
      {activeProvider.hasServiceAccount && (
        <ServiceAccountStatus />
      )}

      {/* Model selector */}
      <ModelSelector
        apiKey={activeApiKey}
        selectedModel={selectedModel}
        onChange={(model) => onChange('selectedModel', model)}
        provider={provider}
      />
    </div>
  );
}
