/**
 * Chat Message List Component
 * Scrollable container for chat messages with auto-scroll and scroll-to-bottom
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { ChatMessage } from './ChatMessage';
import { TypingIndicator } from './TypingIndicator';
import { ScrollToBottom } from '@/components/ui';
import type { KairaChatMessage } from '@/types';

interface ChatMessageListProps {
  messages: KairaChatMessage[];
  isStreaming?: boolean;
  streamingContent?: string;
  onRetry?: (messageId: string) => void;
  onChipClick?: (chipId: string, chipLabel: string) => void;
  updateMessageMetadata?: (messageId: string, metadata: Partial<KairaChatMessage['metadata']>) => Promise<void>;
}

export function ChatMessageList({
  messages,
  isStreaming = false,
  streamingContent = '',
  onRetry,
  onChipClick,
  updateMessageMetadata,
}: ChatMessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track scroll position with IntersectionObserver
  useEffect(() => {
    const bottomEl = bottomRef.current;
    const container = scrollContainerRef.current;
    if (!bottomEl || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAtBottom(entry.isIntersecting);
      },
      { root: container, threshold: 0.1 }
    );

    observer.observe(bottomEl);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll when at bottom and new content arrives
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, streamingContent, isAtBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Find the streaming message (last assistant message with streaming status)
  const streamingMessageId = isStreaming
    ? messages.filter(m => m.role === 'assistant' && m.status === 'streaming').pop()?.id
    : null;

  // Check if a pending message exists (Kaira is thinking but no streaming content yet)
  const hasPendingMessage = isStreaming && messages.some(m => m.status === 'pending');

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 overflow-y-auto"
    >
      <div className="flex flex-col gap-1 py-2">
        {messages.map((message, index) => {
          // Check if previous message is same role for grouping
          const prevMessage = index > 0 ? messages[index - 1] : null;
          const isGrouped = prevMessage?.role === message.role;

          return (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={message.id === streamingMessageId}
              streamingContent={message.id === streamingMessageId ? streamingContent : undefined}
              onRetry={message.status === 'error' ? () => onRetry?.(message.id) : undefined}
              onChipClick={onChipClick}
              updateMessageMetadata={updateMessageMetadata}
              isGrouped={isGrouped}
            />
          );
        })}

        {/* Typing indicator when pending but no streaming content yet */}
        {hasPendingMessage && !streamingMessageId && (
          <TypingIndicator />
        )}
      </div>

      {/* Scroll anchor */}
      <div ref={bottomRef} className="h-px" />

      {/* Scroll to bottom button */}
      <ScrollToBottom
        visible={!isAtBottom}
        onClick={scrollToBottom}
      />
    </div>
  );
}
