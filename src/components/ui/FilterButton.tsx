import { Filter } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from './Button';

interface FilterButtonProps {
  activeCount: number;
  onClick: () => void;
  label?: string;
  className?: string;
}

export function FilterButton({ activeCount, onClick, label = 'Filters', className }: FilterButtonProps) {
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
