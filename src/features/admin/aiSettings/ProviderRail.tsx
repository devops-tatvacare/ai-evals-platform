import { Loader2 } from 'lucide-react';

import { StatusDot } from '@/components/ui';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import type { ProviderConfig } from '@/services/api/aiSettingsApi';
import { useProviderConfigs } from '@/services/api/aiSettingsQueries';
import type { LlmProvider } from '@/services/api/llmCredentialsApi';
import { cn } from '@/utils';

import { ProviderLogo } from './ProviderLogo';

interface ProviderRailProps {
  selected: LlmProvider;
  onSelect: (provider: LlmProvider) => void;
}

const PROVIDER_ORDER: LlmProvider[] = [
  'openai',
  'azure_openai',
  'anthropic',
  'gemini',
  'vertex',
  'bedrock',
];

type RailDotStatus = 'success' | 'error' | 'warning' | 'neutral';

function statusDotFor(p: ProviderConfig): RailDotStatus {
  if (!p.isEnabled) return 'neutral';
  if (p.validationStatus === 'ok') return 'success';
  if (p.validationStatus === 'invalid') return 'error';
  return 'warning';
}

function statusLabel(p: ProviderConfig): string {
  if (!p.isEnabled) return 'Disabled';
  if (!p.hasApiKey) return 'No key';
  switch (p.validationStatus) {
    case 'ok':
      return 'Validated';
    case 'invalid':
      return 'Invalid';
    default:
      return 'Untested';
  }
}

const BACKEND_ONLY_PROVIDERS = new Set<LlmProvider>(['vertex', 'bedrock']);

export function ProviderRail({ selected, onSelect }: ProviderRailProps) {
  const { data, isLoading, isError } = useProviderConfigs();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-secondary)]">
        Failed to load AI settings.
      </div>
    );
  }

  // Backend's bridge surface (`useProviderConfigs`) only knows the four
  // api-key-shaped providers; Vertex+Bedrock get rendered as "Not configured"
  // until the multi-credential admin UI lands.
  const byProvider = new Map<LlmProvider, ProviderConfig>(
    data.map((p) => [p.provider as LlmProvider, p]),
  );

  return (
    <nav
      className="flex w-full flex-col gap-1.5"
      aria-label="LLM provider selector"
    >
      {PROVIDER_ORDER.map((provider) => {
        const config = byProvider.get(provider);
        const isSelected = selected === provider;
        const dot: RailDotStatus = config ? statusDotFor(config) : 'neutral';
        const label = LLM_PROVIDER_LABELS[provider];
        const sub = config
          ? statusLabel(config)
          : BACKEND_ONLY_PROVIDERS.has(provider)
            ? 'Backend ready · UI pending'
            : 'Not configured';
        return (
          <button
            key={provider}
            type="button"
            onClick={() => onSelect(provider)}
            aria-pressed={isSelected}
            className={cn(
              'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
              isSelected
                ? 'border-[var(--border-default)] bg-[var(--bg-tertiary)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-tertiary)]',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <ProviderLogo provider={provider} size={18} />
              <div className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {label}
                </span>
                <span className="truncate text-[11px] text-[var(--text-secondary)]">
                  {sub}
                </span>
              </div>
            </div>
            <StatusDot status={dot} aria-hidden />
          </button>
        );
      })}
    </nav>
  );
}
