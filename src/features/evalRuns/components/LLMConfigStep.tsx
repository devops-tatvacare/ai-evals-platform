import { useEffect } from 'react';
import { ExternalLink, Key, Server } from 'lucide-react';
import { useLLMSettingsStore, hasProviderCredentials, getProviderApiKey, LLM_PROVIDERS } from '@/stores';
import { Alert, LLMConfigSection } from '@/components/ui';
import type { LLMProvider } from '@/types';
import { WizardFieldRow, WizardSection, WizardStepLayout } from './WizardStepLayout';

export interface LLMConfig {
  provider: string;
  model: string;
  temperature: number;
  thinking: string;
}

interface LLMConfigStepProps {
  config: LLMConfig;
  onChange: (config: LLMConfig) => void;
  parallelCases?: boolean;
  caseWorkers?: number;
  maxTurns?: number;
  turnDelay?: number;
  caseDelay?: number;
  onParallelCasesChange?: (value: boolean) => void;
  onCaseWorkersChange?: (value: number) => void;
  onMaxTurnsChange?: (value: number) => void;
  onTurnDelayChange?: (value: number) => void;
  onCaseDelayChange?: (value: number) => void;
  onModelsLoading?: (loading: boolean) => void;
  turnDelayDescription?: string;
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function LLMConfigStep({
  config,
  onChange,
  parallelCases = false,
  caseWorkers = 3,
  maxTurns = 10,
  turnDelay = 1.5,
  caseDelay = 3,
  onParallelCasesChange,
  onCaseWorkersChange,
  onMaxTurnsChange,
  onTurnDelayChange,
  onCaseDelayChange,
  onModelsLoading,
  turnDelayDescription,
}: LLMConfigStepProps) {
  const geminiApiKey = useLLMSettingsStore((s) => s.geminiApiKey);
  const openaiApiKey = useLLMSettingsStore((s) => s.openaiApiKey);
  const azureApiKey = useLLMSettingsStore((s) => s.azureOpenaiApiKey);
  const azureEndpoint = useLLMSettingsStore((s) => s.azureOpenaiEndpoint);
  const anthropicApiKey = useLLMSettingsStore((s) => s.anthropicApiKey);
  const saConfigured = useLLMSettingsStore((s) => s._serviceAccountConfigured);

  const selectedProvider = (config.provider || LLM_PROVIDERS[0].value) as LLMProvider;
  const storeSlice = { geminiApiKey, openaiApiKey, azureOpenaiApiKey: azureApiKey, azureOpenaiEndpoint: azureEndpoint, anthropicApiKey, _serviceAccountConfigured: saConfigured };
  const hasKey = hasProviderCredentials(selectedProvider, storeSlice);
  const effectiveApiKey = getProviderApiKey(selectedProvider, storeSlice);

  // Pre-fill on first render if config is default
  useEffect(() => {
    if (!config.model) {
      onChange({
        provider: LLM_PROVIDERS[0].value,
        model: '',
        temperature: 0.1,
        thinking: 'low',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasKey) {
    return (
      <WizardStepLayout
        eyebrow="Execution"
        title="Choose the judge model"
        description="Pick the provider and runtime settings that will score the run. Credentials have to be ready before you can continue."
      >
        <div className="space-y-4">
          <Alert variant="warning" title="No credentials configured">
            <p>
              You need to configure your {LLM_PROVIDERS.find((p) => p.value === selectedProvider)?.label ?? 'LLM'} API key in Settings
              or set up a service account on the server before running evaluations.
            </p>
            <a
              href="/kaira/settings"
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-brand)] hover:underline"
            >
              Go to Settings <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Alert>

          <WizardSection title="Provider">
            <LLMConfigSection
              provider={selectedProvider}
              onProviderChange={(v) => onChange({ ...config, provider: v, model: '' })}
              model={config.model}
              onModelChange={(model) => onChange({ ...config, model })}
              compact
            />
          </WizardSection>
        </div>
      </WizardStepLayout>
    );
  }

  return (
    <WizardStepLayout
      eyebrow="Execution"
      title="Tune scoring and pacing"
      description="Keep model selection, evaluation temperature, and run-time throttling in one place so the execution profile is easy to reason about."
    >
      <WizardSection title="Model Selection" description="Choose the provider, model, and Gemini thinking level for this run.">
        <LLMConfigSection
          provider={selectedProvider}
          onProviderChange={(v) => onChange({ ...config, provider: v, model: '' })}
          model={config.model}
          onModelChange={(model) => onChange({ ...config, model })}
          showThinking
          thinking={config.thinking}
          onThinkingChange={(thinking) => onChange({ ...config, thinking })}
          onModelsLoading={onModelsLoading}
        />
        <div className="mt-3">
          <WizardFieldRow
            title="Temperature"
            description="Lower values produce more deterministic results. `0.1` is the safest default for evaluations."
            control={(
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={config.temperature}
                onChange={(e) => {
                  const nextValue = Number.parseFloat(e.target.value);
                  onChange({
                    ...config,
                    temperature: Number.isNaN(nextValue) ? 0 : Math.min(Math.max(nextValue, 0), 1),
                  });
                }}
                className="w-full rounded-[10px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]"
              />
            )}
          />
        </div>
      </WizardSection>

      {(onMaxTurnsChange || (onParallelCasesChange && onCaseWorkersChange && onTurnDelayChange && onCaseDelayChange)) && (
      <WizardSection title="Runtime Controls" description="These settings shape turn limits, concurrency, and pacing while the run executes.">
        {(onParallelCasesChange && onCaseWorkersChange && onTurnDelayChange && onCaseDelayChange) && (
          <>
            {onMaxTurnsChange && (
              <WizardFieldRow
                title="Max Turns"
                description="Maximum turns per case before the simulator stops. Multi-goal runs can still scale up to the existing backend safety cap."
                control={(
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={maxTurns}
                    onChange={(e) => onMaxTurnsChange(Math.min(Math.max(Number.parseInt(e.target.value, 10) || 1, 1), 30))}
                    className="w-full rounded-[10px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]"
                  />
                )}
              />
            )}

            <WizardFieldRow
              title="Test Case Parallelism"
              description="Run multiple cases concurrently. When enabled, case delay still spaces out new starts."
              control={(
                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={parallelCases}
                      onChange={(e) => onParallelCasesChange(e.target.checked)}
                    />
                    Enable parallelism
                  </label>
                  {parallelCases && (
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={caseWorkers}
                      onChange={(e) => onCaseWorkersChange(Math.min(Math.max(Number.parseInt(e.target.value, 10) || 2, 2), 20))}
                      className="w-full rounded-[10px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]"
                    />
                  )}
                </div>
              )}
            />

            <WizardFieldRow
              title="Turn Delay"
              description={turnDelayDescription ?? "Delay between user turns to avoid hammering the target service between exchanges."}
              control={(
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={turnDelay}
                  onChange={(e) => onTurnDelayChange(Math.max(Number.parseFloat(e.target.value) || 0, 0))}
                  className="w-full rounded-[10px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]"
                />
              )}
            />

            <WizardFieldRow
              title="Case Delay"
              description="Delay between starting cases. Useful when the environment has strict rate limits."
              control={(
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={caseDelay}
                  onChange={(e) => onCaseDelayChange(Math.max(Number.parseFloat(e.target.value) || 0, 0))}
                  className="w-full rounded-[10px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)]"
                />
              )}
            />
          </>
        )}
      </WizardSection>
      )}

      <WizardSection title="Credential Status" description="Quick confirmation of which auth path this run will use.">
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 px-3 py-2">
            <Key className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[13px] text-[var(--text-secondary)]">
              {effectiveApiKey ? (
                <>API Key: <span className="font-mono">{maskKey(effectiveApiKey)}</span></>
              ) : (
                'No API key configured'
              )}
            </span>
          </div>
          {selectedProvider === 'gemini' && (
            <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)]/70 px-3 py-2">
              <Server className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span className="text-[13px] text-[var(--text-secondary)]">
                {saConfigured
                  ? 'Managed jobs will use Service Account (Vertex AI)'
                  : effectiveApiKey
                    ? 'Managed jobs will use API key (Developer API)'
                    : 'No credentials — configure in Settings'}
              </span>
            </div>
          )}
        </div>
      </WizardSection>
    </WizardStepLayout>
  );
}
