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

const PROSE_CLASSES = cn(
  'prose prose-sm max-w-none text-[13px] text-[var(--text-primary)]',
  // Collapse leading/trailing child margins so the message body doesn't float mid-bubble
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  // Paragraphs
  '[&_p]:text-[13px] [&_p]:mb-2 [&_p]:leading-relaxed [&_p:last-child]:mb-0',
  // Headings — match platform Kaira chat sizing
  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mb-2 [&_h1]:mt-3',
  '[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3',
  '[&_h3]:text-[14px] [&_h3]:font-medium [&_h3]:mb-1.5 [&_h3]:mt-2',
  // Lists
  '[&_ul]:mb-2 [&_ul]:pl-4 [&_ol]:mb-2 [&_ol]:pl-4',
  '[&_li]:mb-1 [&_li]:leading-relaxed',
  // Strong
  '[&_strong]:text-[var(--text-primary)] [&_strong]:font-semibold',
  // Inline code — render as a proper chip. Kill prose plugin's backtick pseudo-elements.
  '[&_code]:font-mono [&_code]:text-xs',
  '[&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5',
  '[&_code]:bg-[var(--bg-code)] [&_code]:border [&_code]:border-[var(--border-code)]',
  '[&_code]:text-[var(--text-primary)]',
  '[&_code:before]:content-none [&_code:after]:content-none',
  // Fenced code blocks
  '[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:bg-[var(--bg-code-block)] [&_pre]:p-3 [&_pre]:text-xs',
  '[&_pre]:border [&_pre]:border-[var(--border-code)]',
  '[&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0',
  // Tables — horizontally scrollable wrapper added via component override
  '[&_table]:my-3 [&_table]:text-xs [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap',
  '[&_th]:border-b [&_th]:border-[var(--border-default)] [&_th]:bg-[var(--bg-secondary)]',
  '[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top',
  '[&_td]:border-b [&_td]:border-[var(--border-default)]',
  // Blockquote
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-default)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)]',
);

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
      <div className={PROSE_CLASSES}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children, ...props }) => (
              <div className="my-3 overflow-x-auto rounded-lg border border-[var(--border-default)]">
                <table {...props}>{children}</table>
              </div>
            ),
          }}
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
