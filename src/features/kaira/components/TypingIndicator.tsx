/**
 * Typing Indicator Component
 * Animated bouncing dots shown when Kaira is generating a response
 */

import { Bot } from 'lucide-react';
import { cn } from '@/utils';

interface TypingIndicatorProps {
  className?: string;
}

export function TypingIndicator({ className }: TypingIndicatorProps) {
  return (
    <div className={cn('flex gap-3 px-5 py-4', className)}>
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
        <Bot className="h-4 w-4" />
      </div>

      {/* Bouncing dots */}
      <div className="flex items-center gap-1 pt-2">
        <span
          className="inline-block h-2 w-2 rounded-full bg-[var(--text-muted)] animate-[typing-dot_1.4s_ease-in-out_infinite]"
        />
        <span
          className="inline-block h-2 w-2 rounded-full bg-[var(--text-muted)] animate-[typing-dot_1.4s_ease-in-out_0.15s_infinite]"
        />
        <span
          className="inline-block h-2 w-2 rounded-full bg-[var(--text-muted)] animate-[typing-dot_1.4s_ease-in-out_0.3s_infinite]"
        />
      </div>
    </div>
  );
}
