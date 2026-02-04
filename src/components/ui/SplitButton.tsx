import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils';

type SplitButtonVariant = 'primary' | 'secondary';
type SplitButtonSize = 'sm' | 'md';

interface DropdownItem {
  label: string;
  icon?: ReactNode;
  action: () => void;
  disabled?: boolean;
  description?: string;
}

interface SplitButtonProps {
  primaryLabel: string;
  primaryIcon?: ReactNode;
  primaryAction: () => void;
  dropdownItems: DropdownItem[];
  disabled?: boolean;
  isLoading?: boolean;
  variant?: SplitButtonVariant;
  size?: SplitButtonSize;
  className?: string;
}

const variantStyles: Record<SplitButtonVariant, { button: string; divider: string }> = {
  primary: {
    button: 'bg-[var(--interactive-primary)] text-[var(--text-on-color)] hover:bg-[var(--interactive-primary-hover)] active:bg-[var(--interactive-primary-active)]',
    divider: 'bg-[var(--text-on-color)]/20',
  },
  secondary: {
    button: 'bg-[var(--interactive-secondary)] text-[var(--text-primary)] hover:bg-[var(--interactive-secondary-hover)] border border-[var(--border-default)]',
    divider: 'bg-[var(--border-default)]',
  },
};

const sizeStyles: Record<SplitButtonSize, string> = {
  sm: 'h-7 text-[13px]',
  md: 'h-8 text-[13px]',
};

export function SplitButton({
  primaryLabel,
  primaryIcon,
  primaryAction,
  dropdownItems,
  disabled = false,
  isLoading = false,
  variant = 'primary',
  size = 'md',
  className,
}: SplitButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleItemClick = (item: DropdownItem) => {
    if (item.disabled) return;
    item.action();
    setIsOpen(false);
  };

  const styles = variantStyles[variant];
  const isDisabled = disabled || isLoading;

  return (
    <div ref={containerRef} className={cn('relative inline-flex', className)}>
      {/* Primary button */}
      <button
        type="button"
        onClick={primaryAction}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-l-[6px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
          'disabled:pointer-events-none disabled:opacity-50',
          styles.button,
          sizeStyles[size],
          'px-3',
          // Remove right border radius and right border for seamless join
          variant === 'secondary' && 'border-r-0'
        )}
      >
        {isLoading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : primaryIcon}
        {primaryLabel}
      </button>

      {/* Divider */}
      <div className={cn('w-px self-stretch', styles.divider, isDisabled && 'opacity-50')} />

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isDisabled}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={cn(
          'inline-flex items-center justify-center rounded-r-[6px] font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
          'disabled:pointer-events-none disabled:opacity-50',
          styles.button,
          sizeStyles[size],
          'px-1.5',
          // Remove left border radius for seamless join
          variant === 'secondary' && 'border-l-0'
        )}
      >
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-[6px]',
            'bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-lg'
          )}
          role="menu"
        >
          <div className="py-1">
            {dropdownItems.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleItemClick(item)}
                disabled={item.disabled}
                role="menuitem"
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]',
                  'text-[var(--text-primary)] hover:bg-[var(--interactive-secondary)]',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
                  'transition-colors'
                )}
              >
                {item.icon && (
                  <span className="text-[var(--text-secondary)] shrink-0">
                    {item.icon}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div>{item.label}</div>
                  {item.description && (
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {item.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
