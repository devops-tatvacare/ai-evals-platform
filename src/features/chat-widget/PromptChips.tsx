import { cn } from '@/utils/cn';
import type { PromptTemplate } from './types';

interface PromptChipsProps {
  templates: PromptTemplate[];
  onSelect: (prompt: string) => void;
}

export function PromptChips({ templates, onSelect }: PromptChipsProps) {
  if (templates.length === 0) return null;

  return (
    <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto">
      {templates.slice(0, 3).map((t) => (
        <button
          key={t.label}
          onClick={() => onSelect(t.prompt)}
          className={cn(
            'shrink-0 text-xs px-3 py-1.5 rounded-full',
            'border border-[var(--border-default)] bg-[var(--bg-secondary)]',
            'text-[var(--text-secondary)] whitespace-nowrap',
            'hover:border-[var(--color-brand-primary)] hover:text-[var(--color-brand-primary)]',
            'hover:bg-[var(--color-brand-accent)]',
            'transition-all duration-150',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
