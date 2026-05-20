import { StatusDot } from '@/components/ui';
import { LLM_PROVIDER_LABELS } from '@/constants/llmProviders';
import { useAllTenantCredentials } from '@/services/api/llmCredentialsQueries';
import type { LlmProvider, TenantCredential } from '@/services/api/llmCredentialsApi';
import { cn } from '@/utils';

import { ProviderLogo } from './ProviderLogo';

interface ProviderRailProps {
  selected: LlmProvider;
  onSelect: (provider: LlmProvider) => void;
}

const PROVIDER_ORDER: LlmProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'azure_openai',
  'bedrock',
  'vertex',
];

type RailDotStatus = 'success' | 'error' | 'warning' | 'neutral';

function summariseProvider(creds: TenantCredential[]): {
  dot: RailDotStatus;
  sub: string;
} {
  if (creds.length === 0) return { dot: 'neutral', sub: 'Not configured' };
  const enabled = creds.filter((c) => c.isEnabled);
  if (enabled.length === 0) {
    return { dot: 'neutral', sub: `${creds.length} disabled` };
  }
  const ok = enabled.filter((c) => c.validationStatus === 'ok').length;
  const invalid = enabled.filter((c) => c.validationStatus === 'invalid').length;
  if (invalid > 0 && ok === 0) {
    return { dot: 'error', sub: `${invalid} invalid` };
  }
  if (invalid > 0) {
    return {
      dot: 'warning',
      sub: `${ok} validated · ${invalid} invalid`,
    };
  }
  if (ok === enabled.length) {
    return { dot: 'success', sub: `${ok} validated` };
  }
  return {
    dot: 'warning',
    sub: `${enabled.length} configured · ${ok} validated`,
  };
}

export function ProviderRail({ selected, onSelect }: ProviderRailProps) {
  const { credentials, isLoading } = useAllTenantCredentials();

  // Bucket credentials by provider for the status row. Every provider in
  // PROVIDER_ORDER renders, even providers the tenant has zero credentials
  // for — the rail is also the entry point to add a brand-new credential.
  const byProvider = new Map<LlmProvider, TenantCredential[]>();
  for (const p of PROVIDER_ORDER) byProvider.set(p, []);
  for (const c of credentials) {
    const arr = byProvider.get(c.provider) ?? [];
    arr.push(c);
    byProvider.set(c.provider, arr);
  }

  return (
    <nav
      className="flex w-full flex-col gap-1.5"
      aria-label="LLM provider selector"
    >
      {PROVIDER_ORDER.map((provider) => {
        const creds = byProvider.get(provider) ?? [];
        const { dot, sub } = isLoading
          ? { dot: 'neutral' as RailDotStatus, sub: 'Loading…' }
          : summariseProvider(creds);
        const isSelected = selected === provider;
        const label = LLM_PROVIDER_LABELS[provider];
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
