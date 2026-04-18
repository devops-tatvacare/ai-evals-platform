import { useState, useCallback, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue('');
    onSend(text);
    if (ref.current) ref.current.style.height = 'auto';
  }, [value, disabled, onSend]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <div className="flex items-end gap-2 px-4 py-2.5 border-t border-[var(--border-default)]">
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
    </div>
  );
}
