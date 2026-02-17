/**
 * Chat Message Component
 * Renders individual chat messages with markdown support
 * - User messages: right-aligned chat bubbles
 * - Assistant messages: plain text with metadata divider below
 */

import { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, RefreshCw, Eye, Clock, Copy, RotateCcw } from 'lucide-react';
import { cn } from '@/utils';
import { Spinner } from '@/components/ui';
import type { KairaChatMessage } from '@/types';
import { actionParser } from '@/services/actions';
import { ActionButtons } from './ActionButtons';
import { NoticeBox, removeNotices, hasNotices } from './NoticeBox';
import { ApiDebugOverlay } from './ApiDebugOverlay';
import { MessageTags } from './MessageTags';
import { useMessageTags } from '@/hooks';

interface ChatMessageProps {
  message: KairaChatMessage;
  isStreaming?: boolean;
  streamingContent?: string;
  onRetry?: () => void;
  onChipClick?: (chipId: string, chipLabel: string) => void;
  updateMessageMetadata?: (messageId: string, metadata: Partial<KairaChatMessage['metadata']>) => Promise<void>;
  /** Whether to hide avatar for consecutive same-role messages */
  isGrouped?: boolean;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Markdown renderer components shared by both user and assistant messages */
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed text-[var(--text-primary)] mb-2 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 space-y-0.5 text-[13px] text-[var(--text-primary)]">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 space-y-0.5 text-[13px] text-[var(--text-primary)]">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-[13px] text-[var(--text-primary)]">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded-sm bg-[var(--bg-code)] text-[13px] font-mono text-[var(--text-primary)]">
          {children}
        </code>
      );
    }
    return (
      <code className={className}>{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="p-3 rounded-lg bg-[var(--bg-code-block)] border border-[var(--border-subtle)] overflow-x-auto mb-3 font-mono">
      {children}
    </pre>
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
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-[var(--color-brand-accent)] pl-3 italic text-[var(--text-secondary)] mb-3">
      {children}
    </blockquote>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2 mt-4">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2 mt-4">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1.5 mt-3">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1 mt-2">{children}</h4>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-2">
      <table className="min-w-full border-collapse border border-[var(--border-default)] text-[12px]">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-[var(--border-default)] px-2.5 py-1.5 bg-[var(--bg-tertiary)] text-left font-medium text-[var(--text-primary)]">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-[var(--border-default)] px-2.5 py-1.5 text-[var(--text-primary)] even:bg-[var(--bg-secondary)]">
      {children}
    </td>
  ),
};

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  streamingContent,
  onRetry,
  onChipClick,
  updateMessageMetadata,
  isGrouped = false,
}: ChatMessageProps) {
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isPending = message.status === 'pending';
  const isCurrentlyStreaming = isStreaming && message.status === 'streaming';
  const hasApiData = !!(message.metadata?.apiRequest || message.metadata?.apiResponse);

  const actionsDisabled = message.metadata?.actionsDisabled ?? false;

  const {
    tags,
    allTags,
    addTag,
    removeTag,
  } = useMessageTags({
    messageId: message.id,
    initialTags: message.metadata?.tags || [],
    appId: 'kaira-bot',
  });

  const rawContent = isCurrentlyStreaming
    ? streamingContent
    : message.content;

  const parseResult = actionParser.parse(rawContent || '');
  const actions = parseResult.actions;
  let displayContent = parseResult.cleanContent;

  const contentHasNotices = displayContent ? hasNotices(displayContent) : false;
  if (displayContent && contentHasNotices) {
    displayContent = removeNotices(displayContent);
  }

  if (displayContent) {
    displayContent = displayContent.replace(
      /^(#{1,6}\s+.+?)(\s*\n)(?!\n)/gm,
      '$1\n\n'
    );
  }

  const handleActionClick = useCallback(async (buttonId: string, buttonLabel: string) => {
    if (updateMessageMetadata) {
      await updateMessageMetadata(message.id, {
        actionsDisabled: true,
      });
    }
    onChipClick?.(buttonId, buttonLabel);
  }, [message.id, updateMessageMetadata, onChipClick]);

  const handleCopy = useCallback(() => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message.content]);

  // ── User message: right-aligned bubble ──
  if (isUser) {
    return (
      <div className={cn('flex flex-col items-end px-5', isGrouped ? 'pt-1 pb-1' : 'py-2')}>
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm bg-[var(--bg-tertiary)] px-4 py-2.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {displayContent || ''}
            </ReactMarkdown>
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-1 text-right">
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message: plain text + metadata divider ──
  return (
    <div className={cn('px-5', isGrouped ? 'pt-1 pb-2' : 'py-3')}>
      {/* Provider label */}
      {!isGrouped && (
        <div className="text-[11px] font-medium text-[var(--text-muted)] mb-1.5">
          Kaira
        </div>
      )}

      {/* Message content */}
      {isPending ? (
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <Spinner size="sm" />
          <span className="text-[13px]">Thinking...</span>
        </div>
      ) : isError ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[var(--color-error)]">
            <AlertCircle className="h-4 w-4" />
            <span className="text-[13px]">
              {message.errorMessage || 'Failed to get response'}
            </span>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 text-[12px] text-[var(--text-brand)] hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] rounded"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>
      ) : (
        <div className="max-w-none">
          {contentHasNotices && rawContent && !isCurrentlyStreaming && (
            <NoticeBox content={rawContent} />
          )}

          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {displayContent || ''}
          </ReactMarkdown>

          {isCurrentlyStreaming && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-[var(--text-brand)] animate-pulse" />
          )}

          {actions.length > 0 && !isCurrentlyStreaming && (
            <ActionButtons
              actions={actions}
              onAction={handleActionClick}
              disabled={actionsDisabled}
            />
          )}
        </div>
      )}

      {/* Metadata divider bar */}
      {message.status === 'complete' && !isCurrentlyStreaming && (
        <div className="flex items-center gap-3 mt-3 pt-2 border-t border-[var(--border-subtle)]">
          {/* Copy */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            title={copied ? 'Copied!' : 'Copy message'}
          >
            <Copy className="h-3 w-3" />
          </button>

          {/* Regenerate / Retry */}
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title="Regenerate response"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}

          {/* Response time */}
          {message.metadata?.processingTime && (
            <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Clock className="h-3 w-3" />
              {message.metadata.processingTime.toFixed(1)}s
            </span>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-[var(--text-muted)]">
            {formatTime(message.createdAt)}
          </span>

          {/* View API */}
          {hasApiData && (
            <button
              onClick={() => setIsApiModalOpen(true)}
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-accent)] rounded"
              title="View API request/response"
            >
              <Eye className="h-3 w-3" />
              <span>API</span>
            </button>
          )}

          {/* Tags */}
          <MessageTags
            currentTags={tags}
            allTags={allTags}
            onAddTag={addTag}
            onRemoveTag={removeTag}
          />

          {/* Intents */}
          {message.metadata?.intents && message.metadata.intents.length > 0 && (
            <span className="text-[10px] text-[var(--text-muted)] ml-auto">
              {message.metadata.intents.map(i => i.agent).join(', ')}
            </span>
          )}
        </div>
      )}

      {/* API Debug Overlay */}
      <ApiDebugOverlay
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        apiRequest={message.metadata?.apiRequest}
        apiResponse={message.metadata?.apiResponse}
      />
    </div>
  );
});
