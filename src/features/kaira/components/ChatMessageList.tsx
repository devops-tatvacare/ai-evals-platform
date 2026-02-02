/**
 * Chat Message List Component
 * Scrollable container for chat messages with auto-scroll
 */

import { useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import type { KairaChatMessage } from '@/types';

interface ChatMessageListProps {
  messages: KairaChatMessage[];
  isStreaming?: boolean;
  streamingContent?: string;
  onRetry?: (messageId: string) => void;
  onChipClick?: (chipId: string, chipLabel: string) => void;
}

export function ChatMessageList({
  messages,
  isStreaming = false,
  streamingContent = '',
  onRetry,
  onChipClick,
}: ChatMessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming content updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Find the streaming message (last assistant message with streaming status)
  const streamingMessageId = isStreaming 
    ? messages.filter(m => m.role === 'assistant' && m.status === 'streaming').pop()?.id 
    : null;

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-[14px]">No messages yet</p>
          <p className="text-[12px] mt-1">Start the conversation by typing a message below</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={scrollContainerRef}
      className="flex-1 overflow-y-auto"
    >
      <div className="divide-y divide-[var(--border-subtle)]">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isStreaming={message.id === streamingMessageId}
            streamingContent={message.id === streamingMessageId ? streamingContent : undefined}
            onRetry={message.status === 'error' ? () => onRetry?.(message.id) : undefined}
            onChipClick={onChipClick}
          />
        ))}
      </div>
      
      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}
