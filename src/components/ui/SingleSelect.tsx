import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

import { cn } from '@/utils';

export interface SingleSelectOption {
  value: string;
  label: string;
}

interface SingleSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SingleSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function SingleSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  disabled = false,
  size = 'md',
}: SingleSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedDropdown) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const updateDropdownPosition = useCallback(() => {
    const trigger = containerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const top = rect.bottom + 4;
    const width = Math.max(rect.width, 220);

    setDropdownPosition({
      left: Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - width - viewportPadding),
      ),
      top,
      width,
      maxHeight: Math.max(160, window.innerHeight - top - viewportPadding),
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateDropdownPosition();
    const handlePositionChange = () => updateDropdownPosition();
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);

    return () => {
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  const selectOption = useCallback((nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  }, [onChange]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setIsOpen((current) => !current);
        }}
        disabled={disabled}
        className={cn(
          'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)]',
          'flex items-center justify-between gap-2 text-left text-[var(--text-primary)]',
          size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]',
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        title={selectedOption?.label}
      >
        <span className={cn('truncate', !selectedOption && 'text-[var(--text-muted)]')}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      </button>

      {isOpen && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg"
          style={{
            left: dropdownPosition.left,
            top: dropdownPosition.top,
            width: dropdownPosition.width,
            maxHeight: Math.min(dropdownPosition.maxHeight, 280),
          }}
        >
          <div className="overflow-y-auto">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectOption(option.value)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors',
                    selected
                      ? 'bg-[var(--surface-brand-subtle)] text-[var(--text-brand)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                      selected
                        ? 'border-[var(--interactive-primary)] bg-[var(--interactive-primary)]'
                        : 'border-[var(--border-default)]',
                    )}
                  >
                    {selected && <Check className="h-2.5 w-2.5 text-[var(--text-on-color)]" />}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
