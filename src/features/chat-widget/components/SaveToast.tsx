import { CheckCircle2, Ruler } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { SaveToastPart } from '../types';

interface SaveToastProps {
  part: SaveToastPart;
}

export function SaveToast({ part }: SaveToastProps) {
  const isBlueprint = part.variant === 'blueprint';
  const Icon = isBlueprint ? Ruler : CheckCircle2;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm animate-[chat-widget-toast-in_220ms_ease-out]',
        isBlueprint
          ? 'border-[color-mix(in_srgb,var(--color-accent-purple)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-accent-purple)_10%,var(--bg-secondary))] text-[var(--color-accent-purple)]'
          : 'border-[var(--border-success)] bg-[var(--surface-success)] text-[var(--color-verdict-pass)]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{part.title}</div>
        <div className="truncate text-xs opacity-80">{part.subtitle}</div>
      </div>
      {part.linkHref && part.linkText ? (
        <a
          href={part.linkHref}
          className="shrink-0 rounded-lg border border-current px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-100"
        >
          {part.linkText}
        </a>
      ) : null}
    </div>
  );
}
