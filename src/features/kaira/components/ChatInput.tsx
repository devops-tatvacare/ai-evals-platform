/**
 * Chat Input Component
 * Text input for sending messages with send button
 */

import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui';
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
  placeholder = 'Type your message...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
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
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={placeholder}
            rows={1}
            className={cn(
              'w-full resize-none rounded-lg border bg-[var(--bg-secondary)] px-4 py-3',
              'text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'border-[var(--border-default)] focus:border-[var(--border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-accent)]/50',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors'
            )}
            style={{ minHeight: '48px', maxHeight: '200px' }}
          />
        </div>

        {/* Send/Cancel Button */}
        {isStreaming ? (
          <Button
            variant="secondary"
            onClick={handleCancelClick}
            className="shrink-0 aspect-square h-[48px] w-[48px] p-0 rounded-lg"
            title="Stop generating"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
            className="shrink-0 aspect-square h-[48px] w-[48px] p-0 rounded-lg"
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {/* Helper text */}
      <div className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
        Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono text-[10px]">Enter</kbd> to send, 
        <kbd className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] font-mono text-[10px] ml-1">Shift+Enter</kbd> for new line
      </div>
    </div>
  );
}
