import { useMemo, useCallback, type ReactNode } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils';

export interface SelectOption {
  value: string;
  label: string;
  leading?: ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Forwarded to Radix `<Select.Content side>` — pick `'top'` when the
   *  trigger lives near the bottom of its container (modal footers, peek
   *  panes) so the menu opens upward instead of clipping. */
  side?: 'top' | 'bottom';
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className,
  disabled = false,
  size = 'md',
  side = 'bottom',
}: SelectProps) {
  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const handleChange = useCallback(
    (next: string) => {
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'w-full rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)]',
          'flex items-center justify-between gap-2 text-left text-[var(--text-primary)]',
          size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3 text-[13px]',
          'focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        title={selectedOption?.label}
        aria-label={selectedOption?.label ?? placeholder}
      >
        <SelectPrimitive.Value
          placeholder={<span className="text-[var(--text-muted)]">{placeholder}</span>}
        />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          side={side}
          sideOffset={4}
          className={cn(
            'z-[var(--z-popover)] overflow-hidden rounded-[var(--radius-default)] border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg',
            'min-w-[220px] w-[var(--radix-select-trigger-width)] max-h-[280px]',
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                textValue={option.label}
                className={cn(
                  'relative flex w-full cursor-default items-center justify-between gap-3 px-3 py-2 text-[13px] outline-none transition-colors',
                  'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)]',
                  'data-[state=checked]:bg-[var(--surface-brand-subtle)] data-[state=checked]:text-[var(--text-brand)]',
                )}
              >
                <SelectPrimitive.ItemText>
                  <span className="flex min-w-0 items-center gap-2">
                    {option.leading}
                    <span className="truncate">{option.label}</span>
                  </span>
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <Check className="h-3.5 w-3.5 text-[var(--text-brand)]" />
                  </span>
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
