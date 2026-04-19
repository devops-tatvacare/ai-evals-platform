import { cn } from '@/utils';

interface AvatarProps {
  name?: string | null;
  size?: 'xs' | 'sm' | 'md';
  title?: string;
  className?: string;
}

const sizeStyles: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-4 w-4 text-[9px]',
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-8 w-8 text-[12px]',
};

function initialsFromName(name: string | null | undefined): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Initials avatar pill. Consumes --chip-brand-* tokens so it follows theme.
 * Use for reviewer/commenter identity across review, audit, and comment surfaces.
 */
export function Avatar({ name, size = 'sm', title, className }: AvatarProps) {
  return (
    <span
      title={title ?? name ?? undefined}
      aria-label={name ?? 'User'}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold select-none',
        'bg-[var(--chip-brand-bg)] text-[var(--chip-brand-text)] border border-[var(--chip-brand-border)]',
        sizeStyles[size],
        className,
      )}
    >
      {initialsFromName(name)}
    </span>
  );
}
