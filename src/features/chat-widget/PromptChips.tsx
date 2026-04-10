import type { PromptTemplate } from './types';

interface PromptChipsProps {
  templates: PromptTemplate[];
  onSelect: (prompt: string) => void;
}

export function PromptChips({ templates, onSelect }: PromptChipsProps) {
  if (templates.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 justify-center mt-3">
      {templates.map((t) => (
        <button
          key={t.label}
          onClick={() => onSelect(t.prompt)}
          className="text-[11px] px-3 py-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--color-brand-primary)] hover:text-[var(--color-brand-primary)] hover:bg-[var(--color-brand-accent)] transition-all truncate max-w-[200px]"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
