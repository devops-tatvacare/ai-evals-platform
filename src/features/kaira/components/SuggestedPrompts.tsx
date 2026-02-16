/**
 * Suggested Prompts Component
 * Clickable prompt chips for the chat empty state
 */

import { MessageSquare } from 'lucide-react';
import { cn } from '@/utils';

const SUGGESTED_PROMPTS = [
  'What are good sources of protein?',
  'Help me plan a balanced meal',
  'What should I eat for recovery after exercise?',
  'How much water should I drink daily?',
];

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  className?: string;
}

export function SuggestedPrompts({ onSelect, className }: SuggestedPromptsProps) {
  return (
    <div className={cn('flex flex-wrap justify-center gap-2', className)}>
      {SUGGESTED_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          onClick={() => onSelect(prompt)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px]',
            'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            'hover:border-[var(--border-focus)] hover:bg-[var(--bg-tertiary)]',
            'transition-colors cursor-pointer'
          )}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          {prompt}
        </button>
      ))}
    </div>
  );
}
