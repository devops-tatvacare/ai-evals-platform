import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';
import { ToolCallBadge } from './ToolCallBadge';
import { PromptChips } from './PromptChips';
import type { WidgetMessage, PromptTemplate } from './types';

interface ChatMessagesProps {
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  promptTemplates: PromptTemplate[];
  onPromptSelect: (prompt: string) => void;
}

export function ChatMessages({ messages, status, promptTemplates, onPromptSelect }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <Sparkles className="h-8 w-8 text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-muted)] max-w-[280px] leading-relaxed">
            Ask me to build reports, explore data, or analyze evaluation results.
          </p>
          <PromptChips templates={promptTemplates} onSelect={onPromptSelect} />
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
          <div
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white',
              msg.role === 'user' ? 'bg-[var(--color-brand-primary)]' : 'bg-[var(--color-level-easy)]',
            )}
          >
            {msg.role === 'user' ? 'Y' : 'AI'}
          </div>

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
