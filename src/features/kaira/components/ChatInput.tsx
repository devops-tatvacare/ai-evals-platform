/**
 * Chat Input Component
 * Text input for sending messages with inline send button
 */

import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { cn } from '@/utils';

interface ChatInputProps {
  onSend: (content: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onCancel,
  disabled = false,
  isStreaming = false,
  placeholder = 'Ask Kaira anything...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }, [value]);

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedValue = value.trim();
    if (!trimmedValue || disabled || isStreaming) return;

    onSend(trimmedValue);
    setValue('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, isStreaming, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleCancelClick = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="bg-[var(--bg-primary)] p-3">
      {/* Unified input container */}
      <div
        className={cn(
          'flex items-end gap-2 rounded-lg border bg-[var(--bg-primary)] px-4 py-3 transition-colors',
          isFocused
            ? 'border-[var(--border-focus)] ring-2 ring-[var(--color-brand-accent)]/50'
            : 'border-[var(--border-default)]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-[14px] text-[var(--text-primary)]',
            'placeholder:text-[var(--text-muted)] focus:outline-none',
            'disabled:cursor-not-allowed'
          )}
          style={{ minHeight: '24px', maxHeight: '160px' }}
        />

        {/* Send/Cancel Button */}
        {isStreaming ? (
          <button
            onClick={handleCancelClick}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              'bg-[var(--interactive-secondary)] text-[var(--text-secondary)]',
              'hover:bg-[var(--interactive-secondary-hover)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1'
            )}
            title="Stop generating"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] focus-visible:ring-offset-1',
              value.trim() && !disabled
                ? 'bg-[var(--interactive-primary)] text-white hover:bg-[var(--interactive-primary-hover)]'
                : 'bg-[var(--interactive-secondary)] text-[var(--text-muted)] cursor-not-allowed'
            )}
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Helper text - visible on focus only */}
      <div
        className={cn(
          'mt-1.5 text-center text-[10px] text-[var(--text-muted)] transition-opacity duration-200',
          isFocused ? 'opacity-100' : 'opacity-0'
        )}
      >
        <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono text-[10px]">Enter</kbd> to send ·{' '}
        <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono text-[10px]">Shift+Enter</kbd> for new line
      </div>
    </div>
  );
}
