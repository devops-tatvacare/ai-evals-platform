import { useEffect } from 'react';
import { ExternalLink, Key, Server, Brain } from 'lucide-react';
import { useLLMSettingsStore, hasLLMCredentials } from '@/stores';
import { ModelSelector } from '@/features/settings/components/ModelSelector';
import { Alert } from '@/components/ui';
import { cn } from '@/utils';
import { THINKING_OPTIONS, getThinkingFamilyHint } from '@/constants/thinking';

export interface LLMConfig {
  provider: string;
  model: string;
  temperature: number;
  thinking: string;
}

interface LLMConfigStepProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
  onModelsLoading?: (loading: boolean) => void;
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function LLMConfigStep({ config, onChange, onModelsLoading }: LLMConfigStepProps) {
  const apiKey = useLLMSettingsStore((state) => state.apiKey);
  const provider = useLLMSettingsStore((state) => state.provider);
  const saConfigured = useLLMSettingsStore((state) => state._serviceAccountConfigured);
  const hasKey = useLLMSettingsStore(hasLLMCredentials);

  // Pre-fill from settings on first render if config is default
  useEffect(() => {
    if (!config.model) {
      const settings = useLLMSettingsStore.getState();
      onChange({
        provider: settings.provider || 'gemini',
        model: settings.selectedModel || '',
        temperature: 0.1,
        thinking: 'low',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasKey) {
    return (
      <div className="space-y-4">
        <Alert variant="warning" title="No credentials configured">
          <p>
            You need to configure your {provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key in Settings
            or set up a service account on the server before running evaluations.
          </p>
          <a
            href="/kaira/settings"
            className="inline-flex items-center gap-1.5 mt-2 text-[var(--text-brand)] hover:underline text-[13px] font-medium"
          >
            Go to Settings <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Provider info */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Provider
        </label>
        <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[14px] text-[var(--text-primary)]">
          {provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Provider is configured in global settings.
        </p>
      </div>

      {/* Model selector */}
      <ModelSelector
        apiKey={apiKey}
        selectedModel={config.model}
        onChange={(model) => onChange({ ...config, model })}
        provider={provider}
        onLoadingChange={onModelsLoading}
      />

      {/* Temperature */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Temperature
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={config.temperature}
            onChange={(e) => onChange({ ...config, temperature: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--interactive-primary)]"
          />
          <span className="text-[14px] font-mono text-[var(--text-primary)] w-10 text-right tabular-nums">
            {config.temperature.toFixed(1)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Lower values produce more deterministic results. Recommended: 0.1 for evaluations.
        </p>
      </div>

      {/* Thinking level (Gemini only) */}
      {provider === 'gemini' && (
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
            <span className="inline-flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              Thinking
            </span>
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {THINKING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...config, thinking: opt.value })}
                className={cn(
                  'px-2.5 py-2 rounded-lg border text-center transition-colors',
                  config.thinking === opt.value
                    ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]/10 text-[var(--interactive-primary)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-prominent)]',
                )}
              >
                <span className="text-[11px] font-medium block">{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {THINKING_OPTIONS.find((o) => o.value === config.thinking)?.description}
            {getThinkingFamilyHint(config.model)}
          </p>
        </div>
      )}

      {/* Credentials status — show both API key and SA status */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <Key className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[13px] text-[var(--text-secondary)]">
            {apiKey ? (
              <>API Key: <span className="font-mono">{maskKey(apiKey)}</span></>
            ) : (
              'No API key configured'
            )}
          </span>
        </div>
        {provider === 'gemini' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
            <Server className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[13px] text-[var(--text-secondary)]">
              {saConfigured
                ? 'Managed jobs will use Service Account (Vertex AI)'
                : apiKey
                  ? 'Managed jobs will use API key (Developer API)'
                  : 'No credentials — configure in Settings'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
