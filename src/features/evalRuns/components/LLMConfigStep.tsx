import { useEffect } from 'react';

import { LegacyLlmConfigCompat, Select } from '@/components/ui';
import { THINKING_OPTIONS, getThinkingFamilyHint } from '@/constants/thinking';
import type { LLMProvider } from '@/services/api/aiSettingsApi';
import { WizardFieldRow, WizardSection, WizardStepLayout } from './WizardStepLayout';

const WIZARD_INPUT_CLASS =
  'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50';

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
  turnDelayDescription?: string;
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
  turnDelayDescription,
}: LLMConfigStepProps) {
  const selectedProvider = (config.provider || '') as LLMProvider | '';

  // Seed defaults on first render if config is empty. Provider is left blank
  // so the user picks from admin-configured providers in LlmModelSelect.
  useEffect(() => {
    if (!config.temperature && !config.thinking) {
      onChange({
        provider: config.provider || '',
        model: '',
        temperature: 0.1,
        thinking: 'low',
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WizardStepLayout
      eyebrow="Execution"
      title="Tune scoring and pacing"
      description="Keep model selection, evaluation temperature, and run-time throttling in one place so the execution profile is easy to reason about."
    >
      <WizardSection title="Model Selection" description="Choose the provider, model, and Gemini thinking level for this run.">
        <LegacyLlmConfigCompat
          callSite="chat_text"
          provider={selectedProvider}
          onProviderChange={(v) => onChange({ ...config, provider: v, model: '' })}
          model={config.model}
          onModelChange={(model) => onChange({ ...config, model })}
          layout="rows"
        />
        {selectedProvider === 'gemini' && (
          <div className="mt-3">
            <WizardFieldRow
              title="Thinking"
              description={`${
                THINKING_OPTIONS.find((o) => o.value === config.thinking)?.description ?? ''
              }${getThinkingFamilyHint(config.model)}`}
              control={(
                <Select
                  value={config.thinking}
                  options={THINKING_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onChange={(value) => onChange({ ...config, thinking: value })}
                />
              )}
            />
          </div>
        )}
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
                className={WIZARD_INPUT_CLASS}
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
                    className={WIZARD_INPUT_CLASS}
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
                      className={WIZARD_INPUT_CLASS}
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
                  className={WIZARD_INPUT_CLASS}
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
                  className={WIZARD_INPUT_CLASS}
                />
              )}
            />
          </>
        )}
      </WizardSection>
      )}
    </WizardStepLayout>
  );
}
