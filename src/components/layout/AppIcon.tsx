import { BrickWallShield, Headset, ShieldAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/utils';
import type { AppIconKind } from './appIconKind';

export type { AppIconKind };

// Glyph names (lucide kebab-case) an app/admin config may reference.
const GLYPHS: Record<string, LucideIcon> = {
  'shield-alert': ShieldAlert,
  'brick-wall-shield': BrickWallShield,
  headset: Headset,
};

interface AppIconProps {
  /** ``'image'`` renders the URL in ``value``; ``'glyph'`` renders the lucide
   *  icon named by ``iconValue`` (see ``GLYPHS``). */
  iconType: AppIconKind;
  iconValue: string;
  name: string;
  /** Tailwind sizing/spacing/colour overrides applied to the wrapper. */
  className?: string;
}

/**
 * Single source of truth for rendering the icon of an app (or the admin
 * surface). Used by ``AppSwitcher`` for both its trigger and dropdown rows,
 * and by the collapsed ``Sidebar`` header. New icon kinds (e.g. an inline
 * SVG component) extend this one switch instead of being scattered across
 * call sites.
 */
export function AppIcon({ iconType, iconValue, name, className }: AppIconProps) {
  if (iconType === 'image') {
    return (
      <img
        src={iconValue}
        alt={name}
        className={cn('rounded object-cover', className)}
      />
    );
  }
  const Glyph = GLYPHS[iconValue] ?? ShieldAlert;
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
        className,
      )}
      aria-label={name}
    >
      <Glyph className="h-4 w-4" />
    </div>
  );
}
