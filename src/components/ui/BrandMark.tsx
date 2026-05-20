import { cn } from '@/utils';

type BrandMarkSize = 'sm' | 'md' | 'lg' | 'xl';

interface BrandMarkProps {
  size?: BrandMarkSize;
  src?: string;
  alt?: string;
  className?: string;
}

const sizeStyles: Record<BrandMarkSize, string> = {
  sm: 'h-[22px] w-[22px] rounded-[var(--radius-default)] text-[11px]',
  md: 'h-7 w-7 rounded-[var(--radius-lg)] text-[13px]',
  lg: 'h-9 w-9 rounded-[var(--radius-lg)] text-[14px] shadow-[var(--shadow-md)]',
  xl: 'h-11 w-11 rounded-[var(--radius-lg)] text-[16px] shadow-[var(--shadow-md)]',
};

export function BrandMark({ size = 'sm', src, alt = 'Tatvacare', className }: BrandMarkProps) {
  if (src) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden bg-[var(--bg-elevated)]',
          sizeStyles[size],
          className,
        )}
      >
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold text-[var(--text-on-color)]',
        sizeStyles[size],
        className,
      )}
      style={{ backgroundImage: 'var(--gradient-brand-mark)' }}
    >
      T
    </span>
  );
}
