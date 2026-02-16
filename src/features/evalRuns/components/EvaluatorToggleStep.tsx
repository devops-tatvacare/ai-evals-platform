import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils';

export interface EvaluatorToggles {
  intent: boolean;
  correctness: boolean;
  efficiency: boolean;
}

interface EvaluatorToggleStepProps {
  evaluators: EvaluatorToggles;
  intentSystemPrompt: string;
  onEvaluatorsChange: (evaluators: EvaluatorToggles) => void;
  onIntentPromptChange: (prompt: string) => void;
}

const EVALUATOR_INFO: { key: keyof EvaluatorToggles; label: string; description: string }[] = [
  { key: 'intent', label: 'Intent Evaluation', description: 'Classify user intents and measure accuracy against expected labels' },
  { key: 'correctness', label: 'Correctness Evaluation', description: 'Verify factual correctness, calorie sanity, and rule compliance' },
  { key: 'efficiency', label: 'Efficiency Evaluation', description: 'Assess conversation flow, friction points, and task completion' },
];

export function EvaluatorToggleStep({
  evaluators,
  intentSystemPrompt,
  onEvaluatorsChange,
  onIntentPromptChange,
}: EvaluatorToggleStepProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeCount = Object.values(evaluators).filter(Boolean).length;

  const handleToggle = (key: keyof EvaluatorToggles) => {
    const newValue = !evaluators[key];
    // Prevent turning off the last active evaluator
    if (!newValue && activeCount <= 1) return;
    onEvaluatorsChange({ ...evaluators, [key]: newValue });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Evaluators
        </label>
        <p className="text-[11px] text-[var(--text-muted)] mb-3">
          Select which evaluations to run on each thread. At least one must be enabled.
        </p>

        <div className="space-y-2">
          {EVALUATOR_INFO.map((info) => {
            const isActive = evaluators[info.key];
            const isLastActive = isActive && activeCount <= 1;

            return (
              <label
                key={info.key}
                className={cn(
                  'flex items-center justify-between px-3 py-3 rounded-[6px] border transition-colors',
                  isActive
                    ? 'border-[var(--interactive-primary)] bg-[var(--color-brand-accent)]/5'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]',
                  isLastActive && 'cursor-not-allowed'
                )}
              >
                <div className="flex-1 min-w-0 mr-3">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{info.label}</span>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{info.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => handleToggle(info.key)}
                  disabled={isLastActive}
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
                    isActive ? 'bg-[var(--interactive-primary)]' : 'bg-[var(--border-default)]',
                    isLastActive && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
                      isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </label>
            );
          })}
        </div>
      </div>

      {/* Advanced section */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Advanced Options
      </button>

      {showAdvanced && (
        <div>
          <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
            Intent System Prompt
          </label>
          <textarea
            value={intentSystemPrompt}
            onChange={(e) => onIntentPromptChange(e.target.value)}
            placeholder="Optional: Custom system prompt for intent classification..."
            rows={4}
            className="w-full rounded-[6px] border bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50 resize-none font-mono"
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Override the default intent classification prompt. Leave empty to use defaults.
          </p>
        </div>
      )}
    </div>
  );
}
