import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowUp, Square } from 'lucide-react';

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

/**
 * Single rounded composer container. Layout (top → bottom):
 *   1. Optional context-attachment chip (BuilderContextChip)
 *   2. Borderless auto-growing textarea
 *   3. Action row: spacer · send/stop button
 *
 * Outer container owns the border + focus-ring (via `focus-within`) so the
 * chip, textarea, and action row read as one unit instead of three stacked
 * widgets. No hex literals; design tokens only.
 */
export function ChatInput({ onSend, onStop, disabled, showStop = false, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const pageContext = usePageContext();
  const [dismissed, setDismissed] = useState(false);
  const showChip = pageContext.kind === 'orchestration_builder' && !dismissed;

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    if (dismissed) {
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
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  const canSend = !!value.trim() && !disabled;

  return (
    <div className="px-2 pb-2 pt-1 border-t border-[var(--border-default)]">
      <div
        className={cn(
          'rounded-lg border bg-[var(--bg-secondary)]',
          'border-[var(--border-default)] transition-colors',
          'focus-within:border-[var(--color-brand-accent)]',
          'focus-within:ring-1 focus-within:ring-[var(--color-brand-accent)]',
          // While the SSE stream is in flight (AbortController active →
          // parent passes `showStop`), swap the static border for the
          // rotating conic-gradient ring defined in globals.css. Strips
          // off automatically the moment the turn terminates.
          showStop ? 'chat-composer-streaming' : '',
          disabled ? 'opacity-70' : '',
        )}
      >
        {showChip ? (
          <div className="px-1.5 pt-1.5 pb-0.5">
            <BuilderContextChip
              pageContext={pageContext}
              onDismiss={() => setDismissed(true)}
            />
          </div>
        ) : null}

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
            'block w-full resize-none bg-transparent border-0 outline-none',
            'px-3 pt-2 pb-1 text-[13px] leading-snug',
            'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'min-h-[28px] max-h-[120px]',
          )}
        />

        <div className="flex items-center justify-end gap-1 px-1.5 pb-1.5">
          {showStop ? (
            <button
              type="button"
              onClick={onStop}
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                'border border-[var(--border-error)] bg-[var(--surface-error)]',
                'text-[var(--color-error)] transition-colors',
                'hover:bg-[color-mix(in_srgb,var(--surface-error)_70%,var(--bg-primary))]',
                'focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[var(--color-brand-accent)]',
              )}
              title="Stop"
              aria-label="Stop"
            >
              <Square className="h-2.5 w-2.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                'transition-colors',
                canSend
                  ? 'bg-[var(--color-brand-primary)] text-[var(--text-inverse)] hover:bg-[var(--color-brand-primary-hover)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[var(--color-brand-accent)]',
              )}
              aria-label="Send"
              title="Send"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
