import { Info } from 'lucide-react';
import { Input } from '@/components/ui';

const ADVERSARIAL_CATEGORIES = [
  'quantity_ambiguity',
  'food_name_confusion',
  'unit_mismatch',
  'emotional_distress',
  'medical_boundary',
  'multi_item_complexity',
  'language_switching',
];

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

interface TestConfigStepProps {
  testCount: number;
  turnDelay: number;
  caseDelay: number;
  onTestCountChange: (count: number) => void;
  onTurnDelayChange: (delay: number) => void;
  onCaseDelayChange: (delay: number) => void;
}

export function TestConfigStep({
  testCount,
  turnDelay,
  caseDelay,
  onTestCountChange,
  onTurnDelayChange,
  onCaseDelayChange,
}: TestConfigStepProps) {
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
          value={testCount}
          onChange={(e) => onTestCountChange(Math.min(50, Math.max(5, parseInt(e.target.value) || 5)))}
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Between 5 and 50 test cases. More tests provide better coverage but take longer.
        </p>
      </div>

      {/* Category distribution info */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Category Distribution
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mb-2">
          Test cases are automatically distributed across {ADVERSARIAL_CATEGORIES.length} categories:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ADVERSARIAL_CATEGORIES.map((cat) => (
            <span
              key={cat}
              className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)] font-mono"
            >
              {cat}
            </span>
          ))}
        </div>
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
