import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/utils';

interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: 'sm' | 'md';
}

export const Switch = forwardRef<
  ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, size = 'md', ...props }, ref) => {
  const rootSize = size === 'sm' ? 'h-6 w-10' : 'h-7 w-12';
  const thumbSize = size === 'sm'
    ? 'h-[18px] w-[18px] data-[state=checked]:translate-x-4'
    : 'h-5 w-5 data-[state=checked]:translate-x-5';

  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex shrink-0 items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-tertiary)] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-[var(--interactive-primary)] data-[state=checked]:bg-[var(--interactive-primary)]',
        rootSize,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-full bg-[var(--bg-primary)] shadow-[0_1px_3px_rgba(0,0,0,0.15)] ring-0 transition-transform',
          thumbSize,
          size === 'sm' ? 'translate-x-0.5' : 'translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

Switch.displayName = 'Switch';
