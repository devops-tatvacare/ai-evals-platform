import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from '@/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
  /** Optional muted secondary text shown on the right of the option row. Also included in search. */
  meta?: string;
  /** Optional node rendered to the left of the option label (e.g. a provider logo). */
  leading?: ReactNode;
  /** Optional node rendered after the label and before the meta column (e.g. capability chips). */
  trailing?: ReactNode;
  /** Optional rich content rendered on a second line below the label.
   *  Use for chip strips / descriptions that would otherwise crowd the
   *  single-row layout when option labels are long. */
  description?: ReactNode;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Called whenever the user types in the search box. Use this to drive
   *  server-side option loading. When set, the client-side filter is
   *  bypassed and the provided `options` are rendered as-is. */
  onSearchChange?: (query: string) => void;
  /** Show a loading row inside the dropdown. Intended for async sources. */
  loading?: boolean;
}

interface SingleComboboxProps extends ComboboxBaseProps {
  multi?: false;
  value: string;
  onChange: (value: string) => void;
}

interface MultiComboboxProps extends ComboboxBaseProps {
  multi: true;
  value: string[];
  onChange: (values: string[]) => void;
}

type ComboboxProps = SingleComboboxProps | MultiComboboxProps;

export function Combobox(props: ComboboxProps) {
  const {
    options,
    placeholder = 'Select...',
    className,
    disabled = false,
    size = 'md',
    multi = false,
    onSearchChange,
    loading = false,
  } = props;
  const isAsync = typeof onSearchChange === 'function';

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    placement: 'top' | 'bottom';
    offset: number;
  } | null>(null);

  const selectedValues: string[] = multi
    ? (props as MultiComboboxProps).value
    : (props as SingleComboboxProps).value
      ? [(props as SingleComboboxProps).value]
      : [];

  useEffect(() => {
    if (!isAsync) return;
    // Relay every keystroke out to the parent; the parent is responsible for
    // debouncing + fetching fresh options.
    onSearchChange?.(search);
  }, [isAsync, onSearchChange, search]);

  const filtered = useMemo(() => {
    // Async mode: options arrive server-filtered, don't re-filter here.
    if (isAsync) return options;
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.searchText?.toLowerCase().includes(q) ||
        o.meta?.toLowerCase().includes(q),
    );
  }, [isAsync, options, search]);

  const selectedLabel = useMemo(() => {
    if (selectedValues.length === 0) return null;
    const labels = selectedValues
      .map((v) => options.find((o) => o.value === v)?.label ?? v)
      .filter(Boolean);
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels.join(', ');
    return `${labels.length} selected`;
  }, [options, selectedValues]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-option]');
    items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered.length]);

  const updatePosition = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const pad = 8;
    const gap = 4;
    const minPreferredHeight = 220;
    const availableBelow = window.innerHeight - rect.bottom - pad - gap;
    const availableAbove = rect.top - pad - gap;
    const placement =
      availableBelow < minPreferredHeight && availableAbove > availableBelow
        ? 'top'
        : 'bottom';
    const availableSpace = placement === 'top' ? availableAbove : availableBelow;
    // Floor of 320px so menu reveals the full label even when the trigger
    // is constrained inside a narrow grid cell (e.g. /admin/llm/defaults
    // rows where "gemini-2.5-flash-preview-09-2025" wouldn't fit in 220).
    // Capped at the viewport width minus 2*pad so it never escapes the
    // page on small screens.
    const width = Math.min(
      Math.max(rect.width, 320),
      window.innerWidth - 2 * pad,
    );
    setPosition({
      left: Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad)),
      width,
      maxHeight: Math.max(120, Math.min(280, availableSpace)),
      placement,
      offset: placement === 'top' ? window.innerHeight - rect.top + gap : rect.bottom + gap,
    });
  }, []);

  const openDropdown = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
    setSearch('');
    setHighlightIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updatePosition]);

  const handleSelect = useCallback(
    (optionValue: string) => {
      if (multi) {
        const onChange = (props as MultiComboboxProps).onChange;
        const current = (props as MultiComboboxProps).value;
        if (current.includes(optionValue)) {
          onChange(current.filter((v) => v !== optionValue));
        } else {
          onChange([...current, optionValue]);
        }
      } else {
        (props as SingleComboboxProps).onChange(optionValue);
        setIsOpen(false);
        setSearch('');
      }
    },
    [multi, props],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (multi) {
        (props as MultiComboboxProps).onChange([]);
      } else {
        (props as SingleComboboxProps).onChange('');
      }
    },
    [multi, props],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          openDropdown();
        }
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[highlightIndex]) handleSelect(filtered[highlightIndex].value);
          break;
        case 'Escape':
          setIsOpen(false);
          setSearch('');
          break;
      }
    },
    [isOpen, filtered, highlightIndex, openDropdown, handleSelect],
  );

  const sizeStyles = size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]';

  return (
    <div ref={containerRef} className={cn('relative', className)} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        disabled={disabled}
        className={cn(
          'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)]',
          'text-left flex items-center justify-between gap-2',
          sizeStyles,
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
          selectedValues.length > 0 && multi && 'border-[var(--border-brand)] bg-[var(--surface-brand-subtle)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'truncate flex-1 min-w-0 inline-flex items-center gap-2',
            selectedLabel
              ? selectedValues.length > 0 && multi
                ? 'font-medium text-[var(--text-brand)]'
                : 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]',
          )}
        >
          {!multi &&
            (() => {
              const sel = options.find((o) => o.value === (props as SingleComboboxProps).value);
              return sel?.leading ? (
                <span className="shrink-0 inline-flex items-center">{sel.leading}</span>
              ) : null;
            })()}
          <span className="truncate">{selectedLabel ?? placeholder}</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selectedValues.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClear(e);
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        </div>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className={cn(
              'fixed z-[var(--z-popover)] rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg',
            )}
            style={{
              left: position.left,
              width: position.width,
              ...(position.placement === 'top'
                ? { bottom: position.offset }
                : { top: position.offset }),
            }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div
              ref={listRef}
              className="overflow-y-auto py-1"
              style={{ maxHeight: Math.min(position.maxHeight, 280) }}
            >
              {loading ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                  {isAsync && !search.trim() ? 'Type to search' : 'No matches found'}
                </div>
              ) : (
                filtered.map((opt, i) => {
                  const selected = selectedValues.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-option
                      onClick={() => handleSelect(opt.value)}
                      title={opt.meta ? `${opt.label} — ${opt.meta}` : opt.label}
                      className={cn(
                        'w-full px-3 py-1.5 text-left text-[13px] flex items-center gap-2 transition-colors',
                        i === highlightIndex && 'bg-[var(--bg-hover)]',
                        selected && !multi && 'text-[var(--text-brand)] font-medium',
                        selected && multi &&
                          'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)] hover:bg-[var(--surface-brand-hover)]',
                        !selected && 'hover:bg-[var(--bg-hover)]',
                      )}
                    >
                      {multi && (
                        <span
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center',
                            selected
                              ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]'
                              : 'border-[var(--border-default)]',
                          )}
                        >
                          {selected && <Check className="h-2.5 w-2.5 text-[var(--text-on-color)]" />}
                        </span>
                      )}
                      {opt.leading && (
                        <span className="shrink-0 inline-flex items-center self-start pt-0.5">
                          {opt.leading}
                        </span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 truncate">
                            {opt.label}
                          </span>
                          {opt.meta && (
                            <span
                              className={cn(
                                'shrink-0 truncate text-[11px] font-normal',
                                selected && multi
                                  ? 'text-[var(--text-brand)]/70'
                                  : 'text-[var(--text-muted)]',
                              )}
                            >
                              {opt.meta}
                            </span>
                          )}
                        </span>
                        {opt.description && (
                          <span className="mt-1 flex items-center gap-1">
                            {opt.description}
                          </span>
                        )}
                      </span>
                      {opt.trailing && (
                        <span className="shrink-0 inline-flex items-center gap-1 self-start pt-0.5">
                          {opt.trailing}
                        </span>
                      )}
                      {!multi && selected && (
                        <Check className="h-3.5 w-3.5 shrink-0 self-start pt-0.5 text-[var(--text-brand)]" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
