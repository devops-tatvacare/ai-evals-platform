import { useState, useEffect } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui';
import { adversarialConfigApi, type AdversarialGoal } from '@/services/api/adversarialConfigApi';

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

type FlowMode = 'single' | 'multi';

interface TestConfigStepProps {
  testCount: number;
  turnDelay: number;
  caseDelay: number;
  selectedGoals: string[];
  flowMode: FlowMode;
  extraInstructions: string;
  onTestCountChange: (count: number) => void;
  onTurnDelayChange: (delay: number) => void;
  onCaseDelayChange: (delay: number) => void;
  onGoalsChange: (goals: string[]) => void;
  onFlowModeChange: (mode: FlowMode) => void;
  onExtraInstructionsChange: (instructions: string) => void;
}

export function TestConfigStep({
  testCount,
  turnDelay,
  caseDelay,
  selectedGoals,
  flowMode,
  extraInstructions,
  onTestCountChange,
  onTurnDelayChange,
  onCaseDelayChange,
  onGoalsChange,
  onFlowModeChange,
  onExtraInstructionsChange,
}: TestConfigStepProps) {
  const [goals, setGoals] = useState<AdversarialGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [testCountLocal, setTestCountLocal] = useState<string | null>(null);
  const [testCountError, setTestCountError] = useState('');

  // Fetch goals from API on mount
  useEffect(() => {
    adversarialConfigApi
      .get()
      .then((config) => {
        const enabled = config.goals.filter((g) => g.enabled);
        setGoals(enabled);
        // Initialize selected goals if empty (first load)
        if (selectedGoals.length === 0) {
          onGoalsChange(enabled.map((g) => g.id));
        }
      })
      .catch((err) => {
        console.error('Failed to load adversarial config:', err);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleGoal = (goalId: string) => {
    if (selectedGoals.includes(goalId)) {
      // Don't allow deselecting the last one
      if (selectedGoals.length <= 1) return;
      onGoalsChange(selectedGoals.filter((g) => g !== goalId));
    } else {
      onGoalsChange([...selectedGoals, goalId]);
    }
  };

  const allSelected = selectedGoals.length === goals.length;
  const handleToggleAll = () => {
    if (allSelected) {
      // Select only first goal (must have at least one)
      onGoalsChange(goals.length > 0 ? [goals[0].id] : []);
    } else {
      onGoalsChange(goals.map((g) => g.id));
    }
  };

  return (
    <div className="space-y-5">
      {/* Test case count */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Number of Test Cases
        </label>
        <Input
          type="number"
          min={5}
          max={50}
          value={testCountLocal ?? String(testCount)}
          error={testCountError}
          onFocus={() => setTestCountLocal(String(testCount))}
          onChange={(e) => {
            const raw = e.target.value;
            setTestCountLocal(raw);
            const parsed = parseInt(raw);
            if (raw === '' || isNaN(parsed)) {
              setTestCountError('');
            } else if (parsed < 5) {
              setTestCountError('Minimum is 5');
            } else if (parsed > 50) {
              setTestCountError('Maximum is 50');
            } else {
              setTestCountError('');
              onTestCountChange(parsed);
            }
          }}
          onBlur={() => {
            const parsed = parseInt(testCountLocal ?? '');
            if (isNaN(parsed) || parsed < 5) {
              // Reset to last valid value
            } else if (parsed > 50) {
              onTestCountChange(50);
            }
            setTestCountError('');
            setTestCountLocal(null);
          }}
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Between 5 and 50 test cases. More tests provide better coverage but take longer.
        </p>
      </div>

      {/* Goal selection */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Goal Selection
            </span>
          </div>
          {!loading && goals.length > 1 && (
            <button
              onClick={handleToggleAll}
              className="text-[10px] text-[var(--text-brand)] hover:underline"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mb-2">
          Test cases target selected goals. Click to toggle.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Loading goals...</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {goals.map((goal) => {
              const isSelected = selectedGoals.includes(goal.id);
              return (
                <button
                  key={goal.id}
                  onClick={() => handleToggleGoal(goal.id)}
                  title={goal.description}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors ${isSelected
                      ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)] ring-1 ring-[var(--color-brand-accent)]/40'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] opacity-60 hover:opacity-80'
                    }`}
                >
                  {goal.label || goal.id}
                </button>
              );
            })}
          </div>
        )}
        {!loading && (
          <p className="text-[10px] text-[var(--text-muted)] mt-2">
            {selectedGoals.length} of {goals.length} goals selected
          </p>
        )}
      </div>

      {/* Flow mode */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Flow Mode
          </span>
        </div>
        <div className="flex gap-2">
          {(['single', 'multi'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onFlowModeChange(mode)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                flowMode === mode
                  ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)] ring-1 ring-[var(--color-brand-accent)]/40'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {mode === 'single' ? 'Single Goal' : 'Multi-Goal'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
          {flowMode === 'single'
            ? 'Each test case targets one goal at a time.'
            : 'Test cases chain multiple goals in a single conversation (longer, more realistic).'}
        </p>
      </div>

      {/* Difficulty distribution info */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Difficulty Distribution
          </span>
        </div>
        <div className="flex gap-3">
          {DIFFICULTY_LEVELS.map((level) => (
            <span key={level} className="text-[12px] text-[var(--text-secondary)] capitalize">
              {level}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">
          Distributed evenly across difficulty levels.
        </p>
      </div>

      {/* Additional instructions */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Additional Instructions <span className="text-[var(--text-muted)] font-normal">(optional)</span>
        </label>
        <textarea
          value={extraInstructions}
          onChange={(e) => onExtraInstructionsChange(e.target.value)}
          placeholder="e.g., Focus on Hindi food items, Test edge cases with very large quantities..."
          rows={3}
          className="w-full rounded-[6px] border border-[var(--border-input)] bg-[var(--bg-primary)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--interactive-primary)] resize-y"
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Appended to the test generation prompt. Use to steer test case style without editing the catalog.
        </p>
      </div>

      {/* Delay sliders */}
      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Turn Delay
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={turnDelay}
            onChange={(e) => onTurnDelayChange(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--interactive-primary)]"
          />
          <span className="text-[14px] font-mono text-[var(--text-primary)] w-12 text-right tabular-nums">
            {turnDelay.toFixed(1)}s
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Delay between conversation turns within a test case.
        </p>
      </div>

      <div>
        <label className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5">
          Case Delay
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={caseDelay}
            onChange={(e) => onCaseDelayChange(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--interactive-primary)]"
          />
          <span className="text-[14px] font-mono text-[var(--text-primary)] w-12 text-right tabular-nums">
            {caseDelay.toFixed(1)}s
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Delay between test cases to avoid API rate limiting.
        </p>
      </div>
    </div>
  );
}
