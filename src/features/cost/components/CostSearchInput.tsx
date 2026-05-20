import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/utils';

interface CostSearchInputProps {
  /** Current committed search value. Tab can reflect store state here. */
  value: string;
  /** Called after the debounce window with the trimmed query. Empty string clears. */
  onCommit: (query: string) => void;
  placeholder: string;
  /** Debounce window in ms. 250 by default — fast enough to feel live, slow enough to
   * avoid firing a request on every keystroke. */
  debounceMs?: number;
  className?: string;
  /** Optional meta label rendered on the right (e.g. "12 of 340"). */
  countLabel?: string;
  autoFocus?: boolean;
}

/**
 * Shared search input used by cost tabs. Owns local draft state and only
 * surfaces a committed query to the parent after the debounce window so the
 * store/API do not thrash on every keystroke.
 */
export function CostSearchInput({
  value,
  onCommit,
  placeholder,
  debounceMs = 250,
  className,
  countLabel,
  autoFocus,
}: CostSearchInputProps) {
  const [draft, setDraft] = useState(value);
  // Distinguish a genuine external value change (e.g. a filter reset) from the
  // echo of our own commit, so the echo never clobbers in-flight keystrokes.
  const [lastValue, setLastValue] = useState(value);
  const [committed, setCommitted] = useState(value);

  // Adjust during render (not in an effect) when the prop changes externally.
  // Re-syncing the committed echo would drop characters when the debounce is
  // short. See react.dev "you might not need an effect".
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== committed) {
      setDraft(value);
    }
  }

  // Commit after the debounce window.
  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    const handle = setTimeout(() => {
      setCommitted(trimmed);
      onCommit(trimmed);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [draft, value, debounceMs, onCommit]);

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="relative w-[360px] max-w-full">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--input-bg)] py-1.5 pl-8 pr-8 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--border-brand)]/30 focus:border-[var(--border-focus)]"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoFocus={autoFocus}
        />
        {draft && (
          <button
            type="button"
            onClick={() => setDraft('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--interactive-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {countLabel && (
        <div className="text-[11px] text-[var(--text-muted)] tabular-nums">{countLabel}</div>
      )}
    </div>
  );
}
