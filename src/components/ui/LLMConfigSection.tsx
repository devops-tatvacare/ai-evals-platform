import { ProviderToggle } from './ProviderToggle';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { useLLMSettingsStore, getProviderApiKey, LLM_PROVIDERS } from '@/stores';
import { THINKING_OPTIONS, getThinkingFamilyHint } from '@/constants/thinking';
import { Brain } from 'lucide-react';
import { cn } from '@/utils';
import type { LLMProvider } from '@/types';

interface LLMConfigSectionProps {
  provider: LLMProvider;
  onProviderChange: (p: LLMProvider) => void;
  model: string;
  onModelChange: (m: string) => void;
  showThinking?: boolean;
  thinking?: string;
  onThinkingChange?: (t: string) => void;
  compact?: boolean;
  /** Direction for model dropdown. Default 'down'. */
  dropdownDirection?: 'up' | 'down';
  /** Called when model discovery loading state changes */
  onModelsLoading?: (loading: boolean) => void;
}

/**
 * Grouped LLM configuration section: provider toggle + model selector + optional thinking.
 * Resolves API key from store internally. Use in overlays, wizards, and inline config cards.
 */
export function LLMConfigSection({
  provider,
  onProviderChange,
  model,
  onModelChange,
  showThinking = false,
  thinking,
  onThinkingChange,
  compact = false,
  dropdownDirection = 'down',
  onModelsLoading,
}: LLMConfigSectionProps) {
  const geminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const anthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);

  const storeSlice = { geminiApiKey, openaiApiKey, azureOpenaiApiKey: azureApiKey, azureOpenaiEndpoint: azureEndpoint, anthropicApiKey };
  const effectiveApiKey = getProviderApiKey(provider, storeSlice);

  const handleProviderChange = (p: LLMProvider) => {
    onProviderChange(p);
  };

  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-default)]',
      compact ? 'p-2.5 space-y-2.5' : 'p-4 space-y-4',
    )}>
      {/* Provider toggle */}
      <div>
        {!compact && (
          <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">
            Provider
          </label>
        )}
        <ProviderToggle
          providers={LLM_PROVIDERS}
          value={provider}
          onChange={handleProviderChange}
        />
      </div>

      {/* Model selector */}
      <ModelSelector
        apiKey={effectiveApiKey}
        azureEndpoint={azureEndpoint}
        selectedModel={model}
        onChange={onModelChange}
        provider={provider}
        dropdownDirection={dropdownDirection}
        onLoadingChange={onModelsLoading}
      />

      {/* Thinking controls (optional) */}
      {showThinking && provider === 'gemini' && onThinkingChange && (
        <div>
          {!compact && (
            <label className="block text-[12px] font-medium text-[var(--text-primary)] mb-1.5">
              <span className="inline-flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" />
                Thinking
              </span>
            </label>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            {THINKING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onThinkingChange(opt.value)}
                className={cn(
                  'px-2 py-1.5 rounded-lg border text-center transition-colors',
                  thinking === opt.value
                    ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-prominent)]',
                )}
              >
                <span className="text-[11px] font-medium block">{opt.label}</span>
              </button>
            ))}
          </div>
          {!compact && (
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              {THINKING_OPTIONS.find((o) => o.value === thinking)?.description}
              {getThinkingFamilyHint(model)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
