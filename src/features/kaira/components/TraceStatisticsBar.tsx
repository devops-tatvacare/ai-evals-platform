/**
 * Trace Statistics Bar
 * Displays conversation-level statistics and metrics
 */

import { MessageSquare, Clock, Activity, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { KairaChatMessage } from '@/types';
import { extractTraceData } from '../utils/traceDataExtractor';

interface TraceStatisticsBarProps {
  messages: KairaChatMessage[];
}

export function TraceStatisticsBar({ messages }: TraceStatisticsBarProps) {
  // Calculate statistics
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  
  // Calculate average processing time for assistant messages
  const processingTimes = assistantMessages
    .map(m => extractTraceData(m.metadata).processingTime)
    .filter((time): time is number => time !== undefined);
  const avgProcessingTime = processingTimes.length > 0
    ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
    : null;
  
  // Count agents used
  const agentCounts: Record<string, number> = {};
  assistantMessages.forEach(m => {
    const extracted = extractTraceData(m.metadata);
    if (extracted.primaryIntent?.agent) {
      agentCounts[extracted.primaryIntent.agent] = (agentCounts[extracted.primaryIntent.agent] || 0) + 1;
    }
  });
  
  // Calculate success rate (used in stats bar, not directly in this component)
  const completedMessages = messages.filter(m => m.status === 'complete');
  const errorMessages = messages.filter(m => m.status === 'error');
  
  // Calculate total conversation duration
  if (messages.length === 0) return null;
  
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const durationMs = new Date(lastMessage.createdAt).getTime() - new Date(firstMessage.createdAt).getTime();
  const durationMinutes = Math.floor(durationMs / 1000 / 60);
  const durationSeconds = Math.floor((durationMs / 1000) % 60);
  
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-4 text-[11px]">
        {/* Total Messages */}
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">
            {messages.length} messages
          </span>
          <span className="text-[var(--text-muted)]">
            ({userMessages.length} user / {assistantMessages.length} bot)
          </span>
        </div>
        
        {/* Average Processing Time */}
        {avgProcessingTime !== null && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">avg</span>
            <span className="text-[var(--text-primary)] font-medium">
              {avgProcessingTime.toFixed(2)}s
            </span>
          </div>
        )}
        
        {/* Primary Agents */}
        {Object.keys(agentCounts).length > 0 && (
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            {Object.entries(agentCounts)
              .sort(([, a], [, b]) => b - a)
              .map(([agent, count]) => (
                <Badge key={agent} variant="primary" className="text-[9px]">
                  {agent} ({count})
                </Badge>
              ))}
          </div>
        )}
        
        {/* Success / Errors */}
        <div className="flex items-center gap-1.5">
          <CheckCircle className="h-3.5 w-3.5 text-[var(--color-success)]" />
          <span className="text-[var(--color-success)]">{completedMessages.length}</span>
          {errorMessages.length > 0 && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              <XCircle className="h-3.5 w-3.5 text-[var(--color-error)]" />
              <span className="text-[var(--color-error)]">{errorMessages.length}</span>
            </>
          )}
        </div>
        
        {/* Duration */}
        {durationMs > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="text-[var(--text-muted)]">
              {durationMinutes > 0 && `${durationMinutes}m `}
              {durationSeconds}s
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
