import { cn } from '@/utils/cn';

interface SherlockIconProps {
  className?: string;
}

const SHERLOCK_ICON_MASK = 'url("/sherlock-icon.svg") center / contain no-repeat';

export function SherlockIcon({ className }: SherlockIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 bg-current', className)}
      style={{
        WebkitMask: SHERLOCK_ICON_MASK,
        mask: SHERLOCK_ICON_MASK,
      }}
    />
  );
}
