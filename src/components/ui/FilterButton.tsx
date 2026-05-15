import { Filter } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from './Button';

interface FilterButtonProps {
  activeCount: number;
  onClick: () => void;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}

export function FilterButton({
  activeCount,
  onClick,
  label = 'Filters',
  className,
  iconOnly = false,
}: FilterButtonProps) {
  if (iconOnly) {
    // Badge anchored at the button's top-right corner with a small inward
    // inset so it stays fully inside the button's bounding box. Prevents
    // any parent layout (toolbars, tab borders, flex rows with no top
    // padding) from clipping it across every consumer of FilterButton.
    return (
      <div className={cn('relative inline-flex', className)}>
        <Button
          variant="secondary"
          size="sm"
          icon={Filter}
          iconOnly
          onClick={onClick}
          aria-label={label}
          title={label}
        />
        {activeCount > 0 && (
          <span className="pointer-events-none absolute right-0.5 top-0.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--interactive-primary)] px-1 text-[9px] font-semibold leading-none text-[var(--text-on-color)]">
            {activeCount}
          </span>
        )}
      </div>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={Filter}
      onClick={onClick}
      className={cn('relative', className)}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {activeCount > 0 && (
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--interactive-primary)] px-1.5 text-[10px] font-semibold text-[var(--text-on-color)]">
            {activeCount}
          </span>
        )}
      </span>
    </Button>
  );
}
