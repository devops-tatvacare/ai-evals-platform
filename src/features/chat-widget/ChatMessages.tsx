import { memo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, RotateCcw } from 'lucide-react';
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
import { SaveToast } from './components/SaveToast';
import { ToolGroup } from './components/ToolGroup';
import { ToolStack } from './components/ToolStack';
import type {
  MessagePart,
  ToolCallPart,
  WidgetMessage,
} from './types';

const PROSE_CLASSES = cn(
  'prose prose-sm max-w-none text-[var(--text-primary)]',
  // Paragraphs
  '[&_p]:mb-2 [&_p]:leading-relaxed [&_p:last-child]:mb-0',
  // Headings
  '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mb-2 [&_h1]:mt-3',
  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3',
  '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1.5 [&_h3]:mt-2',
  // Lists
  '[&_ul]:mb-2 [&_ul]:pl-4 [&_ol]:mb-2 [&_ol]:pl-4',
  '[&_li]:mb-1 [&_li]:leading-relaxed',
  // Strong / code
  '[&_strong]:text-[var(--text-primary)] [&_strong]:font-semibold',
  '[&_code]:rounded [&_code]:bg-[var(--bg-primary)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
  // Tables — horizontally scrollable wrapper added via component override
  '[&_table]:text-xs [&_table]:w-full [&_table]:border-collapse',
  '[&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:whitespace-nowrap',
  '[&_th]:border-b [&_th]:border-[var(--border-default)] [&_th]:bg-[var(--bg-secondary)]',
  '[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top',
  '[&_td]:border-b [&_td]:border-[var(--border-default)]',
  // Blockquote
  '[&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-default)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-muted)]',
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
      <div className="rounded-2xl rounded-br-md border border-[color-mix(in_srgb,var(--interactive-primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--interactive-primary)_14%,var(--bg-primary))] px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]">
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
              <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
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
      <div key={`${message.id}-retry`} className="flex items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--interactive-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--interactive-danger)_6%,var(--bg-primary))] px-4 py-3 text-sm text-[var(--text-primary)]">
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

function StreamingAssistantMessage({ initials, appId, sessionId }: { initials: string; appId: string; sessionId: string | null }) {
  const streamingParts = useChatWidgetStore((state) => state.streamingParts);
  const appendMessagePart = useChatWidgetStore((state) => state.appendMessagePart);
  const updateMessagePart = useChatWidgetStore((state) => state.updateMessagePart);

  if (streamingParts.length === 0) {
    return (
      <div className="mr-auto flex w-full gap-2.5">
        <Avatar role="assistant" initials={initials} />
        <div className="rounded-2xl bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-muted)]">Thinking…</div>
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
      </div>
    </div>
  );
}

interface ChatMessagesProps {
  messages: WidgetMessage[];
  status: 'idle' | 'sending' | 'error';
  appId: string;
  onRetry: () => void;
}

export function ChatMessages({ messages, status, appId, onRetry }: ChatMessagesProps) {
  const displayName = useAuthStore((state) => state.user?.displayName);
  const initials = getUserInitials(displayName);
  const sessionId = useChatWidgetStore((state) => state.sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof node.scrollTo !== 'function') {
      return;
    }

    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromBottom < 120 || status === 'sending') {
      node.scrollTo({ top: node.scrollHeight, behavior: status === 'sending' ? 'auto' : 'smooth' });
    }
  }, [messages, status]);

  const hasEmptyState = messages.length === 0 && status !== 'sending';

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
      <div className="flex flex-col gap-4">
        {hasEmptyState ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
            <img src="/sherlock-icon.svg" alt="Sherlock" className="mb-4 h-12 w-12 opacity-40 dark:invert" />
            <p className="max-w-[320px] text-sm leading-relaxed text-[var(--text-muted)]">
              Ask Sherlock to inspect schema, run queries, build charts, or compose a reusable analytics blueprint.
            </p>
          </div>
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
      </div>
    </div>
  );
}
