import { cn } from '@/utils/cn';
import { Lock } from 'lucide-react';
import type { ChatProvider } from './types';

interface ProviderToggleProps {
  selected: ChatProvider | null;
  onSelect: (p: ChatProvider) => void;
  locked: boolean;
  disabled: Record<ChatProvider, boolean>;
}

const PROVIDERS: Array<{ value: ChatProvider; label: string; color: string }> = [
  { value: 'gemini', label: 'Gemini', color: 'var(--color-level-easy)' },
  { value: 'openai', label: 'OpenAI', color: 'var(--color-verdict-pass)' },
];

export function ProviderToggle({ selected, onSelect, locked, disabled }: ProviderToggleProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-subtle)]">
      {PROVIDERS.map((p) => {
        if (locked && selected !== p.value) return null;
        const isActive = selected === p.value;
        const isDisabled = disabled[p.value];

        return (
          <button
            key={p.value}
            onClick={() => !locked && !isDisabled && onSelect(p.value)}
            disabled={isDisabled || locked}
            title={isDisabled ? 'Configure in Settings → LLM Auth' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all',
              'border',
              isActive
                ? 'border-[var(--color-brand-primary)] bg-[var(--color-brand-accent)] text-[var(--color-brand-primary)]'
                : 'border-[var(--border-default)] text-[var(--text-muted)]',
              isDisabled && 'opacity-40 cursor-not-allowed',
              !isDisabled && !locked && !isActive && 'hover:border-[var(--border-strong)] cursor-pointer',
            )}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.label}
            {locked && isActive && <Lock className="h-2.5 w-2.5" />}
          </button>
        );
      })}
      {locked && selected && (
        <span className="ml-auto text-[10px] font-mono text-[var(--text-muted)]">
          {selected === 'gemini' ? 'gemini-3-flash-preview' : 'gpt-5.4-mini'}
        </span>
      )}
    </div>
  );
}
