import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import { ToolCallBadge } from './ToolCallBadge';
import type { WidgetMessage } from './types';

function getUserInitials(displayName?: string): string {
  if (!displayName) return '?';
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

interface ChatMessagesProps {
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
}

export function ChatMessages({ messages, status }: ChatMessagesProps) {
  const displayName = useAuthStore((s) => s.user?.displayName);
  const initials = getUserInitials(displayName);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <img src="/sherlock-icon.svg" alt="Sherlock" className="h-12 w-12 opacity-30 dark:invert mb-3" />
          <p className="text-sm text-[var(--text-muted)] max-w-[280px] leading-relaxed">
            Ask me to build reports, explore data, or analyze evaluation results.
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            'flex gap-2 max-w-[92%]',
            msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
          )}
        >
          {msg.role === 'user' ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-[10px] font-bold text-white">
              {initials}
            </div>
          ) : (
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, #2D1B69 100%)' }}
            >
              <img src="/sherlock-icon.svg" alt="Sherlock" className="h-3.5 w-3.5 invert" />
            </div>
          )}

          <div
            className={cn(
              'rounded-lg px-3 py-2 text-[13px] leading-relaxed',
              msg.role === 'user'
                ? 'bg-[var(--color-brand-primary)] text-white rounded-br-sm'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-bl-sm',
              msg.status === 'error' && 'border border-[var(--color-verdict-fail)] bg-[var(--color-verdict-fail)]/5',
            )}
          >
            {msg.toolCalls.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {msg.toolCalls.map((tc) => (
                  <ToolCallBadge key={tc.name} {...tc} />
                ))}
              </div>
            )}

            {msg.role === 'assistant' && msg.content ? (
              <div className="prose prose-sm max-w-none [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_li]:mb-0 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border-subtle)] [&_td]:border [&_td]:border-[var(--border-subtle)] [&_th]:bg-[var(--bg-secondary)] [&_strong]:text-[var(--text-primary)] [&_code]:text-[11px] [&_code]:bg-[var(--bg-secondary)] [&_code]:px-1 [&_code]:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <span>{msg.content}</span>
            )}

            {msg.status === 'streaming' && !msg.content && msg.toolCalls.length === 0 && (
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking&hellip;
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
