import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  dismissNextPageContext,
  usePageContext,
} from '@/features/orchestration/copilot/usePageContext';
import { BuilderContextChip } from './components/BuilderContextChip';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled: boolean;
  showStop?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, onStop, disabled, showStop = false, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Phase 2 (sherlock-builder) — chip is derived from page context, not
  // stored. `dismissed` is per-message ephemeral state: clicking [×]
  // hides the chip locally AND signals `dismissNextPageContext` so the
  // upcoming `getPageContextSnapshot` call returns 'none'. After send,
  // the flag is consumed and `dismissed` resets so the chip reappears
  // for the next turn (per the design — chip is derived, not stored).
  const pageContext = usePageContext();
  const [dismissed, setDismissed] = useState(false);
  const showChip = pageContext.kind === 'orchestration_builder' && !dismissed;

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    if (dismissed) {
      // The chip was [×]'d for this single message — strip the page
      // context from the next snapshot and reset the chip for the next
      // turn so the user sees it back.
      dismissNextPageContext();
      setDismissed(false);
    }
    setValue('');
    onSend(text);
    if (ref.current) ref.current.style.height = 'auto';
  }, [value, disabled, onSend, dismissed]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <div className="border-t border-[var(--border-default)]">
      {showChip ? (
        <BuilderContextChip
          pageContext={pageContext}
          onDismiss={() => setDismissed(true)}
        />
      ) : null}
      <div className="flex items-end gap-2 px-4 py-2.5">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder ?? 'Type a message...'}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)]',
            'px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-accent)]',
            'min-h-[36px] max-h-[120px]',
          )}
        />
        {showStop ? (
          <button
            onClick={onStop}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
              'border-[var(--border-error)] bg-[var(--surface-error)] text-[var(--color-error)]',
              'hover:bg-[color-mix(in_srgb,var(--surface-error)_70%,var(--bg-primary))]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)]',
            )}
            title="Stop"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!value.trim() || disabled}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              'bg-[var(--color-brand-primary)] text-white',
              'hover:bg-[var(--color-brand-primary-hover)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
