import { useRef, useEffect, useCallback, memo } from 'react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Loader2, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import { notificationService } from '@/services/notifications';
import { Button } from '@/components/ui';
import { ToolCallBadge } from './ToolCallBadge';
import { ComposedReportCard } from './ComposedReportCard';
import { ChatChart } from './ChatChart';
import { useChatWidgetStore } from './useChatWidget';
import type { WidgetMessage, ToolCallBadgeData } from './types';
import type { Components } from 'react-markdown';

const PROSE_CLASSES = 'prose prose-sm max-w-none overflow-hidden [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_li]:mb-0 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border-subtle)] [&_td]:border [&_td]:border-[var(--border-subtle)] [&_th]:bg-[var(--bg-secondary)] [&_strong]:text-[var(--text-primary)] [&_code]:text-[11px] [&_code]:bg-[var(--bg-secondary)] [&_code]:px-1 [&_code]:rounded';

/** Custom renderers — wraps tables in a horizontal scroll container. */
const MARKDOWN_COMPONENTS: Components = {
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props}>{children}</table>
    </div>
  ),
};

function getUserInitials(displayName?: string): string {
  if (!displayName) return '?';
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

// ── Reusable pieces ────────────────────────────────────────────────

function AssistantMessageActions({
  content,
  isError,
  onRetry,
}: {
  content: string;
  isError: boolean;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    notificationService.success('Message copied');
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
      <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={handleCopy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {isError && (
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

function ToolCallBadges({ toolCalls, collapsed }: { toolCalls: ToolCallBadgeData[]; collapsed?: boolean }) {
  if (toolCalls.length === 0) return null;
  if (collapsed) {
    const failed = toolCalls.filter((tc) => tc.status === 'failed').length;
    const label = failed
      ? `${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''} ran · ${failed} failed`
      : `${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''} ran`;
    return (
      <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono font-medium bg-[var(--bg-secondary)] text-[var(--text-muted)]">
        {label}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {toolCalls.map((tc) => (
        <ToolCallBadge key={tc.name} {...tc} />
      ))}
    </div>
  );
}

function MessageBubble({
  role,
  content,
  isError,
  children,
}: {
  role: 'user' | 'assistant';
  content?: string;
  isError?: boolean;
  children?: React.ReactNode;
}) {
  const body = children ?? (
    role === 'assistant' && content ? (
      <div className={PROSE_CLASSES}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {content}
        </ReactMarkdown>
      </div>
    ) : (
      <span>{content}</span>
    )
  );

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-[13px] leading-relaxed',
        role === 'user'
          ? 'bg-[var(--color-brand-primary)] text-white rounded-br-sm'
          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded-bl-sm',
        isError && 'border border-[var(--color-verdict-fail)] bg-[var(--color-verdict-fail)]/5',
      )}
    >
      {body}
    </div>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────

function Avatar({ role, initials }: { role: 'user' | 'assistant'; initials: string }) {
  if (role === 'user') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-primary)] text-[10px] font-bold text-white">
        {initials}
      </div>
    );
  }
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
      style={{ background: 'linear-gradient(135deg, var(--color-brand-primary) 0%, var(--color-brand-primary-hover) 50%, var(--color-brand-primary-deep) 100%)' }}
    >
      <img src="/sherlock-icon.svg" alt="Sherlock" className="h-3.5 w-3.5 invert" />
    </div>
  );
}

// ── Individual message (memoized — won't re-render during streaming) ─

interface MessageItemProps {
  msg: WidgetMessage;
  initials: string;
  appId: string;
  onRetry: () => void;
  onSaveComposedReport: (reportName: string) => void;
}

const MessageItem = memo(function MessageItem({
  msg,
  initials,
  appId,
  onRetry,
  onSaveComposedReport,
}: MessageItemProps) {
  const isError = msg.status === 'error';

  return (
    <div
      className={cn(
        'group flex gap-2 max-w-[92%]',
        msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
      )}
    >
      <Avatar role={msg.role} initials={initials} />

      <div className="flex flex-col gap-1 min-w-0">
        <ToolCallBadges toolCalls={msg.toolCalls} collapsed={isError} />

        <MessageBubble
          role={msg.role}
          content={msg.content || (isError ? 'Something went wrong.' : undefined)}
          isError={isError}
        />

        {msg.role === 'assistant' && msg.composedReport && (
          <ComposedReportCard
            report={msg.composedReport}
            onSaveTemplate={onSaveComposedReport}
          />
        )}

        {msg.role === 'assistant' && msg.chart && (
          <ChatChart chart={msg.chart} appId={appId} />
        )}

        {msg.role === 'assistant' && (msg.content || isError) && (
          <AssistantMessageActions
            content={msg.content}
            isError={isError}
            onRetry={onRetry}
          />
        )}
      </div>
    </div>
  );
});

// ── Streaming message (reads from streaming store fields) ──────────

function StreamingMessage({ initials }: { initials: string }) {
  const content = useChatWidgetStore((s) => s.streamingContent);
  const toolCalls = useChatWidgetStore((s) => s.streamingToolCalls);
  const chart = useChatWidgetStore((s) => s.streamingChart);

  const showThinking = !content && toolCalls.length === 0;
  const showBubble = !!content || showThinking;

  return (
    <div className="group flex gap-2 max-w-[92%] mr-auto">
      <Avatar role="assistant" initials={initials} />

      <div className="flex flex-col gap-1 min-w-0">
        <ToolCallBadges toolCalls={toolCalls} />

        {showBubble && (
          content ? (
            <MessageBubble role="assistant" content={content} />
          ) : (
            <MessageBubble role="assistant">
              <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking&hellip;
              </span>
            </MessageBubble>
          )
        )}

        {chart && <ChatChart chart={chart} appId="" />}
      </div>
    </div>
  );
}

// ── Streaming scroll tracker (subscribes to store outside React render) ──

/**
 * Scrolls the container to bottom on streaming content changes.
 * Lives outside ChatMessages render cycle so it doesn't cause re-renders.
 */
function StreamingScrollTracker({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const streamingContent = useChatWidgetStore((s) => s.streamingContent);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!streamingContent || !scrollRef.current) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'instant' as ScrollBehavior });
    });
  }, [streamingContent, scrollRef]);

  return null;
}

// ── Main component ─────────────────────────────────────────────────

interface ChatMessagesProps {
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  appId: string;
  onRetry: () => void;
  onSaveComposedReport: (reportName: string) => void;
}

export function ChatMessages({ messages, status, appId, onRetry, onSaveComposedReport }: ChatMessagesProps) {
  const displayName = useAuthStore((s) => s.user?.displayName);
  const initials = getUserInitials(displayName);
  const isStreaming = status === 'sending';
  const scrollRef = useRef<HTMLDivElement>(null);

  // Smooth-scroll when messages array changes (new message added/completed)
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: isStreaming ? 'instant' as ScrollBehavior : 'smooth',
    });
  }, [messages, isStreaming]);

  // Stable callbacks for memoized MessageItem
  const handleRetry = useCallback(() => onRetry(), [onRetry]);
  const handleSaveReport = useCallback((name: string) => onSaveComposedReport(name), [onSaveComposedReport]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
      {messages.length === 0 && !isStreaming && (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <img src="/sherlock-icon.svg" alt="Sherlock" className="h-12 w-12 opacity-30 dark:invert mb-3" />
          <p className="text-sm text-[var(--text-muted)] max-w-[280px] leading-relaxed">
            Ask me to discover data, analyze trends, visualize results, or build report templates.
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          initials={initials}
          appId={appId}
          onRetry={handleRetry}
          onSaveComposedReport={handleSaveReport}
        />
      ))}

      {isStreaming && <StreamingMessage initials={initials} />}
      {isStreaming && <StreamingScrollTracker scrollRef={scrollRef} />}
    </div>
  );
}
