/**
 * Trace Analysis View
 * Displays message-by-message trace metadata for a chat session
 */

import { Card } from '@/components/ui';
import { TraceMessageRow } from './TraceMessageRow';
import type { KairaChatMessage } from '@/types';

interface TraceAnalysisViewProps {
  messages: KairaChatMessage[];
}

export function TraceAnalysisView({ messages }: TraceAnalysisViewProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="p-8 text-center">
          <p className="text-[var(--text-secondary)]">No messages in this conversation yet</p>
        </Card>
      </div>
    );
  }

  // Display messages in reverse chronological order (newest first)
  const reversedMessages = [...messages].reverse();

  return (
    <div className="space-y-4 p-6 h-full overflow-y-auto">
      <div className="text-sm text-[var(--text-secondary)] mb-4">
        {messages.length} message{messages.length !== 1 ? 's' : ''} in this conversation
      </div>
      
      <div className="space-y-3">
        {reversedMessages.map((message) => (
          <TraceMessageRow key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
