import { useState, useEffect } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui';
import { adversarialConfigApi, type AdversarialCategory } from '@/services/api/adversarialConfigApi';

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard'];

interface TestConfigStepProps {
  testCount: number;
  turnDelay: number;
  caseDelay: number;
  selectedCategories: string[];
  extraInstructions: string;
  onTestCountChange: (count: number) => void;
  onTurnDelayChange: (delay: number) => void;
  onCaseDelayChange: (delay: number) => void;
  onCategoriesChange: (categories: string[]) => void;
  onExtraInstructionsChange: (instructions: string) => void;
}

export function TestConfigStep({
  testCount,
  turnDelay,
  caseDelay,
  selectedCategories,
  extraInstructions,
  onTestCountChange,
  onTurnDelayChange,
  onCaseDelayChange,
  onCategoriesChange,
  onExtraInstructionsChange,
}: TestConfigStepProps) {
  const [categories, setCategories] = useState<AdversarialCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch categories from API on mount
  useEffect(() => {
    adversarialConfigApi
      .get()
      .then((config) => {
        const enabled = config.categories.filter((c) => c.enabled);
        setCategories(enabled);
        // Initialize selected categories if empty (first load)
        if (selectedCategories.length === 0) {
          onCategoriesChange(enabled.map((c) => c.id));
        }
      })
      .catch((err) => {
        console.error('Failed to load adversarial config:', err);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleCategory = (catId: string) => {
    if (selectedCategories.includes(catId)) {
      // Don't allow deselecting the last one
      if (selectedCategories.length <= 1) return;
      onCategoriesChange(selectedCategories.filter((c) => c !== catId));
    } else {
      onCategoriesChange([...selectedCategories, catId]);
    }
  };

  const allSelected = selectedCategories.length === categories.length;
  const handleToggleAll = () => {
    if (allSelected) {
      // Select only first category (must have at least one)
      onCategoriesChange(categories.length > 0 ? [categories[0].id] : []);
    } else {
      onCategoriesChange(categories.map((c) => c.id));
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
          value={testCount}
          onChange={(e) => onTestCountChange(Math.min(50, Math.max(5, parseInt(e.target.value) || 5)))}
        />
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          Between 5 and 50 test cases. More tests provide better coverage but take longer.
        </p>
      </div>

      {/* Category selection */}
      <div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Category Selection
            </span>
          </div>
          {!loading && categories.length > 1 && (
            <button
              onClick={handleToggleAll}
              className="text-[10px] text-[var(--text-brand)] hover:underline"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mb-2">
          Test cases are distributed across selected categories. Click to toggle.
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Loading categories...</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const isSelected = selectedCategories.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => handleToggleCategory(cat.id)}
                  title={cat.description}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition-colors ${isSelected
                      ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)] ring-1 ring-[var(--color-brand-accent)]/40'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] opacity-60 hover:opacity-80'
                    }`}
                >
                  {cat.label || cat.id}
                </button>
              );
            })}
          </div>
        )}
        {!loading && (
          <p className="text-[10px] text-[var(--text-muted)] mt-2">
            {selectedCategories.length} of {categories.length} categories selected
          </p>
        )}
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
