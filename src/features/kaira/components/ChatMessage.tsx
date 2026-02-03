/**
 * Chat Message Component
 * Renders individual chat messages with markdown support
 */

import { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, AlertCircle, RefreshCw, Eye } from 'lucide-react';
import { cn } from '@/utils';
import { Spinner } from '@/components/ui';
import type { KairaChatMessage } from '@/types';
import { actionParser } from '@/services/actions';
import { ActionButtons } from './ActionButtons';
import { NoticeBox, removeNotices, hasNotices } from './NoticeBox';
import { ApiDebugModal } from './ApiDebugModal';

interface ChatMessageProps {
  message: KairaChatMessage;
  isStreaming?: boolean;
  streamingContent?: string;
  onRetry?: () => void;
  onChipClick?: (chipId: string, chipLabel: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  streamingContent,
  onRetry,
  onChipClick,
}: ChatMessageProps) {
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [actionsDisabled, setActionsDisabled] = useState(false);
  
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isPending = message.status === 'pending';
  const isCurrentlyStreaming = isStreaming && message.status === 'streaming';
  const hasApiData = !!(message.metadata?.apiRequest || message.metadata?.apiResponse);

  // Determine content to display
  const rawContent = isCurrentlyStreaming 
    ? streamingContent 
    : message.content;
  
  // Parse actions and clean content
  const parseResult = actionParser.parse(rawContent || '');
  const actions = parseResult.actions;
  let displayContent = parseResult.cleanContent;
  
  // Check if content has notices and remove them
  const contentHasNotices = displayContent ? hasNotices(displayContent) : false;
  if (displayContent && contentHasNotices) {
    displayContent = removeNotices(displayContent);
  }
  
  // Normalize markdown: ensure headings have blank line after them
  // This fixes cases where API sends "#### Heading  \nContent" without blank line
  if (displayContent) {
    displayContent = displayContent.replace(
      /^(#{1,6}\s+.+?)(\s*\n)(?!\n)/gm, 
      '$1\n\n'
    );
  }
  
  // Handle action button clicks
  const handleActionClick = useCallback((buttonId: string, buttonLabel: string) => {
    // Disable all action buttons after first click
    setActionsDisabled(true);
    // Call the original handler
    onChipClick?.(buttonId, buttonLabel);
  }, [onChipClick]);

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-4',
        isUser ? 'bg-transparent' : 'bg-[var(--bg-secondary)]'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser 
            ? 'bg-[var(--color-brand-accent)]/20 text-[var(--text-brand)]' 
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Role label and API debug button */}
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-[var(--text-muted)]">
            {isUser ? 'You' : 'Kaira'}
          </div>
          {hasApiData && !isUser && (
            <button
              onClick={() => setIsApiModalOpen(true)}
              className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-brand)] transition-colors"
              title="View API request/response"
            >
              <Eye className="h-3 w-3" />
              <span>API</span>
            </button>
          )}
        </div>

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
                className="flex items-center gap-1.5 text-[12px] text-[var(--text-brand)] hover:underline"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            {/* Notice Boxes (render before main content) */}
            {contentHasNotices && rawContent && !isCurrentlyStreaming && (
              <NoticeBox content={rawContent} />
            )}
            
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Custom component styling for markdown elements
                p: ({ children }) => (
                  <p className="text-[14px] leading-relaxed text-[var(--text-primary)] mb-3 last:mb-0">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc pl-4 mb-3 space-y-1 text-[14px] text-[var(--text-primary)]">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-4 mb-3 space-y-1 text-[14px] text-[var(--text-primary)]">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-[14px] text-[var(--text-primary)]">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic">{children}</em>
                ),
                code: ({ className, children }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[13px] font-mono text-[var(--text-primary)]">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={className}>{children}</code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="p-3 rounded-lg bg-[var(--bg-tertiary)] overflow-x-auto mb-3">
                    {children}
                  </pre>
                ),
                a: ({ href, children }) => (
                  <a 
                    href={href} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[var(--text-brand)] hover:underline"
                  >
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-[var(--border-default)] pl-3 italic text-[var(--text-secondary)] mb-3">
                    {children}
                  </blockquote>
                ),
                h1: ({ children }) => (
                  <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2 mt-4">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-semibold text-[var(--text-primary)] mb-2 mt-3">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-2 mt-4">{children}</h3>
                ),
                h4: ({ children }) => (
                  <h4 className="text-[14px] font-semibold text-[var(--text-primary)] mb-2 mt-3">{children}</h4>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-3">
                    <table className="min-w-full border-collapse border border-[var(--border-default)] text-[13px]">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-[var(--border-default)] px-3 py-2 bg-[var(--bg-tertiary)] text-left font-medium">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-[var(--border-default)] px-3 py-2">
                    {children}
                  </td>
                ),
              }}
            >
              {displayContent || ''}
            </ReactMarkdown>
            
            {/* Streaming cursor */}
            {isCurrentlyStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-[var(--text-brand)] animate-pulse" />
            )}
            
            {/* Action Buttons */}
            {actions.length > 0 && !isCurrentlyStreaming && (
              <ActionButtons 
                actions={actions} 
                onAction={handleActionClick}
                disabled={actionsDisabled}
              />
            )}
          </div>
        )}

        {/* Metadata (processing time, agents) */}
        {message.status === 'complete' && message.metadata?.processingTime && (
          <div className="text-[11px] text-[var(--text-muted)]">
            {message.metadata.processingTime.toFixed(2)}s
            {message.metadata.intents && message.metadata.intents.length > 0 && (
              <span className="ml-2">
                • {message.metadata.intents.map(i => i.agent).join(', ')}
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* API Debug Modal */}
      <ApiDebugModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        apiRequest={message.metadata?.apiRequest}
        apiResponse={message.metadata?.apiResponse}
      />
    </div>
  );
});
