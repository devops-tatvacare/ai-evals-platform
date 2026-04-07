import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from '@/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
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
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedValues: string[] = multi
    ? (props as MultiComboboxProps).value
    : (props as SingleComboboxProps).value
      ? [(props as SingleComboboxProps).value]
      : [];

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        o.searchText?.toLowerCase().includes(q),
    );
  }, [options, search]);

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
    const top = rect.bottom + 4;
    const width = Math.max(rect.width, 220);
    setPosition({
      left: Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad)),
      top,
      width,
      maxHeight: Math.max(160, window.innerHeight - top - pad),
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
            'truncate',
            selectedLabel
              ? selectedValues.length > 0 && multi
                ? 'font-medium text-[var(--text-brand)]'
                : 'text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]',
          )}
        >
          {selectedLabel ?? placeholder}
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
              'fixed z-[var(--z-dropdown)] rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg',
            )}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
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
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No matches found</div>
              ) : (
                filtered.map((opt, i) => {
                  const selected = selectedValues.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-option
                      onClick={() => handleSelect(opt.value)}
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
                      <span className="truncate">{opt.label}</span>
                      {!multi && selected && (
                        <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-[var(--text-brand)]" />
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
