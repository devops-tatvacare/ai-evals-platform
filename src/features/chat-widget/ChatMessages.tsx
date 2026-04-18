import { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, ArrowDown, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import { useChatWidgetStore } from './useChatWidget';
import {
  buildSaveTemplatePrompt,
  isBlueprintPart,
  isChartPart,
  isSaveToastPart,
  isToolCallPart,
} from './chatWidgetHelpers';
import { BlueprintCard } from './components/BlueprintCard';
import { ChatChartCard } from './components/ChatChartCard';
import { EmptyState } from './components/EmptyState';
import { SaveToast } from './components/SaveToast';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { ToolGroup } from './components/ToolGroup';
import { ToolStack } from './components/ToolStack';
import { phrasesForContext } from './thinkingPhrases';
import type {
  MessagePart,
  PromptTemplate,
  ToolCallPart,
  WidgetMessage,
} from './types';

const MARKDOWN_CONTAINER_CLASSES = 'text-[13px] text-[var(--text-primary)]';

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[15px] font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[14px] font-semibold mt-2 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-[13px] font-semibold mt-2 mb-1 first:mt-0">{children}</h4>
  ),
  h5: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="text-[12px] font-semibold uppercase tracking-wide mt-2 mb-1 first:mt-0 text-[var(--text-secondary)]">{children}</h5>
  ),
  h6: ({ children }: { children?: React.ReactNode }) => (
    <h6 className="text-[11px] font-semibold uppercase tracking-wide mt-2 mb-1 first:mt-0 text-[var(--text-muted)]">{children}</h6>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed marker:text-[var(--text-muted)] has-[>input[type=checkbox]]:list-none has-[>input[type=checkbox]]:-ml-5">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  del: ({ children }: { children?: React.ReactNode }) => (
    <del className="line-through text-[var(--text-muted)]">{children}</del>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--text-brand)] hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isBlock = !!className?.startsWith('language-');
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="font-mono text-xs rounded px-1.5 py-0.5 bg-[var(--bg-code)] border border-[var(--border-code)] text-[var(--text-primary)]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-3 rounded-lg bg-[var(--bg-code-block)] border border-[var(--border-code)] p-3 text-xs overflow-x-auto last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-[var(--border-default)] pl-3 text-[var(--text-muted)] italic last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse border border-[var(--border-default)] text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-[var(--border-default)] px-2.5 py-1.5 align-top even:bg-[var(--bg-secondary)]">
      {children}
    </td>
  ),
  input: ({ type, checked, ...props }: { type?: string; checked?: boolean }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          className="mr-1.5 align-middle accent-[var(--interactive-primary)]"
          {...props}
        />
      );
    }
    return <input type={type} {...props} />;
  },
};

function getUserInitials(displayName?: string): string {
  if (!displayName) {
    return '?';
  }
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function Avatar({ role, initials }: { role: 'user' | 'assistant'; initials: string }) {
  if (role === 'user') {
    return (
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--interactive-primary)] text-[11px] font-bold text-[var(--text-on-color)]">
        {initials}
      </div>
    );
  }

  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--color-brand-primary),var(--color-brand-primary-deep))]">
      <img src="/sherlock-icon.svg" alt="Sherlock" className="h-4 w-4 brightness-0 invert" />
    </div>
  );
}

function UserMessage({ message, initials }: { message: WidgetMessage; initials: string }) {
  const text = message.parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('');

  return (
    <div className="ml-auto flex max-w-[88%] flex-row-reverse gap-3">
      <Avatar role="user" initials={initials} />
      <div className="rounded-2xl rounded-br-md border border-[color-mix(in_srgb,var(--interactive-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--interactive-primary)_14%,var(--bg-primary))] px-4 py-3 text-[13px] leading-relaxed text-[var(--text-primary)]">
        {text}
      </div>
    </div>
  );
}

function TextPartBlock({
  content,
  isError,
}: {
  content: string;
  isError?: boolean;
}) {
  return (
    <div
      className={cn(
        isError
          ? 'rounded-2xl border border-[color-mix(in_srgb,var(--interactive-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_8%,var(--bg-primary))] px-4 py-3'
          : '',
      )}
    >
      <div className={MARKDOWN_CONTAINER_CLASSES}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function renderAssistantParts(
  message: WidgetMessage,
  appId: string,
  sessionId: string | null,
  onRetry: () => void,
  appendMessagePart: (messageId: string, part: MessagePart) => void,
  updateMessagePart: (messageId: string, matcher: (part: MessagePart) => boolean, next: MessagePart) => void,
) {
  const blocks: React.ReactNode[] = [];
  let toolGroup: ToolCallPart[] = [];

  const flushToolGroup = (autoCollapsed: boolean) => {
    if (toolGroup.length === 0) {
      return;
    }
    const key = `${message.id}-tools-${blocks.length}`;
    blocks.push(
      autoCollapsed
        ? <ToolGroup key={key} tools={toolGroup} autoCollapsed />
        : <ToolStack key={key} tools={toolGroup} />,
    );
    toolGroup = [];
  };

  for (let index = 0; index < message.parts.length; index += 1) {
    const part = message.parts[index];
    const nextPart = message.parts[index + 1];

    if (isToolCallPart(part)) {
      toolGroup.push(part);
      const nextIsTool = nextPart && isToolCallPart(nextPart);
      if (!nextIsTool) {
        const autoCollapsed = toolGroup.every((tool) => tool.state !== 'executing') && nextPart?.type === 'text';
        flushToolGroup(autoCollapsed);
      }
      continue;
    }

    if (part.type === 'text') {
      blocks.push(
        <TextPartBlock
          key={`${message.id}-text-${index}`}
          content={part.content}
          isError={message.status === 'error'}
        />,
      );
      continue;
    }

    if (isChartPart(part)) {
      blocks.push(
        <ChatChartCard
          key={`${message.id}-chart-${index}`}
          part={part}
          appId={appId}
          sessionId={sessionId}
          onSaved={(nextChartPart, toast) => {
            updateMessagePart(message.id, (candidate) => candidate === part, nextChartPart);
            appendMessagePart(message.id, toast);
          }}
        />,
      );
      continue;
    }

    if (isBlueprintPart(part)) {
      blocks.push(
        <BlueprintCard
          key={`${message.id}-blueprint-${index}`}
          part={part}
          onSave={() => {
            void useChatWidgetStore.getState().send(buildSaveTemplatePrompt(part.name), appId);
          }}
        />,
      );
      continue;
    }

    if (isSaveToastPart(part)) {
      blocks.push(<SaveToast key={`${message.id}-toast-${index}`} part={part} />);
    }
  }

  if (message.status === 'error') {
    blocks.push(
      <div key={`${message.id}-retry`} className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--interactive-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_6%,var(--bg-primary))] px-4 py-3 text-[13px] text-[var(--text-primary)]">
        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--interactive-danger)]" />
        <div className="min-w-0 flex-1">
          <div className="font-medium capitalize">{message.terminalStatus ?? 'error'}</div>
          <div className="text-xs text-[var(--text-muted)]">Retry the last prompt to continue.</div>
        </div>
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onRetry}>
          Retry
        </Button>
      </div>,
    );
  }

  return blocks;
}

interface AssistantMessageProps {
  message: WidgetMessage;
  appId: string;
  initials: string;
  sessionId: string | null;
  onRetry: () => void;
}

const AssistantMessage = memo(function AssistantMessage({
  message,
  appId,
  initials,
  sessionId,
  onRetry,
}: AssistantMessageProps) {
  const appendMessagePart = useChatWidgetStore((state) => state.appendMessagePart);
  const updateMessagePart = useChatWidgetStore((state) => state.updateMessagePart);

  return (
    <div className="mr-auto flex w-full gap-2.5">
      <Avatar role="assistant" initials={initials} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Sherlock
          {message.terminalStatus ? <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] capitalize tracking-normal">{message.terminalStatus}</span> : null}
        </div>
        {renderAssistantParts(message, appId, sessionId, onRetry, appendMessagePart, updateMessagePart)}
      </div>
    </div>
  );
}, (prevProps, nextProps) => prevProps.message === nextProps.message && prevProps.sessionId === nextProps.sessionId);

function shouldShowInterPartThinking(parts: MessagePart[]): boolean {
  if (parts.length === 0) {
    return false;
  }
  const last = parts[parts.length - 1];
  return isToolCallPart(last) && last.state !== 'executing';
}

function StreamingAssistantMessage({ initials, appId, sessionId }: { initials: string; appId: string; sessionId: string | null }) {
  const streamingParts = useChatWidgetStore((state) => state.streamingParts);
  const streamingStatus = useChatWidgetStore((state) => state.streamingStatus);
  const appendMessagePart = useChatWidgetStore((state) => state.appendMessagePart);
  const updateMessagePart = useChatWidgetStore((state) => state.updateMessagePart);

  if (streamingParts.length === 0) {
    return (
      <div className="mr-auto flex w-full gap-2.5">
        <Avatar role="assistant" initials={initials} />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Sherlock</div>
          <ThinkingIndicator literalText={streamingStatus ?? undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="mr-auto flex w-full gap-2.5">
      <Avatar role="assistant" initials={initials} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Sherlock</div>
        {renderAssistantParts(
          {
            id: 'streaming',
            role: 'assistant',
            parts: streamingParts,
            status: 'streaming',
          },
          appId,
          sessionId,
          () => {},
          appendMessagePart,
          updateMessagePart,
        )}
        {shouldShowInterPartThinking(streamingParts) ? (() => {
          const pool = phrasesForContext(streamingParts);
          return (
            <ThinkingIndicator
              key={streamingStatus ?? pool[0]}
              phrases={pool}
              literalText={streamingStatus ?? undefined}
            />
          );
        })() : null}
      </div>
    </div>
  );
}

interface ChatMessagesProps {
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  appId: string;
  onRetry: () => void;
  promptTemplates?: PromptTemplate[];
  onPromptSelect?: (prompt: string) => void;
}

export function ChatMessages({ messages, status, appId, onRetry, promptTemplates, onPromptSelect }: ChatMessagesProps) {
  const displayName = useAuthStore((state) => state.user?.displayName);
  const initials = getUserInitials(displayName);
  const sessionId = useChatWidgetStore((state) => state.sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Mirror atBottom in a ref so the ResizeObserver callback reads the current value
  // without re-binding on every change. State drives the jump-pill re-render.
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const setBottom = useCallback((v: boolean) => {
    atBottomRef.current = v;
    setAtBottom((prev) => (prev === v ? prev : v));
  }, []);

  // Track follow-state via a bottom sentinel. IntersectionObserver fires on real
  // layout transitions — robust to streaming races that plague scrollTop math.
  // Small positive rootMargin gives a tolerance band so minor jitter doesn't flicker.
  useEffect(() => {
    const scroller = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        setBottom(visible);
      },
      { root: scroller, rootMargin: '0px 0px 24px 0px', threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [setBottom]);

  // Auto-scroll whenever content grows, but only if the user is already at the bottom.
  // ResizeObserver covers every content mutation: message added, tool chip, text delta, status swap.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // On send, always snap to bottom and re-engage follow — the user clicked send, they want to see it.
  // The scrollTop assignment triggers the IntersectionObserver to re-confirm atBottom=true.
  useEffect(() => {
    if (status !== 'sending') return;
    const node = scrollRef.current;
    if (!node) return;
    atBottomRef.current = true;
    node.scrollTop = node.scrollHeight;
  }, [status]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    atBottomRef.current = true;
    // Instant during streaming to avoid fighting the ResizeObserver; smooth when idle.
    if (status === 'sending') {
      node.scrollTop = node.scrollHeight;
    } else {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  }, [status]);

  const hasEmptyState = messages.length === 0 && status !== 'sending';
  const showJumpPill = !atBottom && status === 'sending';

  return (
    <div className="relative flex min-h-0 flex-1">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div ref={contentRef} className={cn('flex flex-col gap-4', hasEmptyState ? 'h-full' : 'px-3 py-3')}>
        {hasEmptyState ? (
          <EmptyState
            appId={appId}
            templates={promptTemplates ?? []}
            onSelect={(prompt) => onPromptSelect?.(prompt)}
          />
        ) : null}

        {messages.map((message) => (
          message.role === 'user' ? (
            <UserMessage key={message.id} message={message} initials={initials} />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              appId={appId}
              initials={initials}
              sessionId={sessionId}
              onRetry={onRetry}
            />
          )
        ))}

        {status === 'sending' ? <StreamingAssistantMessage initials={initials} appId={appId} sessionId={sessionId} /> : null}
        <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
        </div>
      </div>

      {showJumpPill ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          className={cn(
            'absolute bottom-3 left-1/2 z-[var(--z-sticky)] flex -translate-x-1/2 items-center gap-1.5',
            'rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.04em]',
            'border bg-[var(--bg-elevated)]/95 backdrop-blur-sm shadow-lg',
            'border-[color-mix(in_srgb,var(--interactive-primary)_45%,transparent)]',
            'text-[var(--text-brand)]',
            'hover:bg-[var(--surface-brand-hover)] transition-colors',
          )}
        >
          <ArrowDown className="h-3 w-3" strokeWidth={2.5} />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
