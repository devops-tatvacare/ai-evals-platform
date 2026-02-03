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
  
  // Calculate success rate
  const completedMessages = messages.filter(m => m.status === 'complete');
  const errorMessages = messages.filter(m => m.status === 'error');
  const successRate = messages.length > 0
    ? (completedMessages.length / messages.length) * 100
    : 0;
  
  // Calculate total conversation duration
  if (messages.length === 0) return null;
  
  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const durationMs = new Date(lastMessage.timestamp).getTime() - new Date(firstMessage.timestamp).getTime();
  const durationMinutes = Math.floor(durationMs / 1000 / 60);
  const durationSeconds = Math.floor((durationMs / 1000) % 60);
  
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-4 mb-4">
      <div className="flex items-center gap-6 flex-wrap">
        {/* Total Messages */}
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[var(--text-muted)]" />
          <div className="text-[12px]">
            <span className="text-[var(--text-secondary)]">Messages: </span>
            <span className="font-semibold text-[var(--text-primary)]">
              {messages.length}
            </span>
            <span className="text-[var(--text-muted)] ml-1">
              ({userMessages.length}👤 / {assistantMessages.length}🤖)
            </span>
          </div>
        </div>
        
        {/* Average Processing Time */}
        {avgProcessingTime !== null && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" />
            <div className="text-[12px]">
              <span className="text-[var(--text-secondary)]">Avg Time: </span>
              <span className="font-semibold text-[var(--text-primary)]">
                {avgProcessingTime.toFixed(2)}s
              </span>
            </div>
          </div>
        )}
        
        {/* Primary Agents */}
        {Object.keys(agentCounts).length > 0 && (
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--text-muted)]" />
            <div className="text-[12px] text-[var(--text-secondary)]">
              Agents:
            </div>
            <div className="flex items-center gap-1.5">
              {Object.entries(agentCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([agent, count]) => (
                  <Badge key={agent} variant="primary">
                    {agent}: {count}
                  </Badge>
                ))}
            </div>
          </div>
        )}
        
        {/* Success Rate */}
        <div className="flex items-center gap-2">
          {successRate === 100 ? (
            <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
          ) : (
            <Activity className="h-4 w-4 text-[var(--text-muted)]" />
          )}
          <div className="text-[12px]">
            <span className="text-[var(--text-secondary)]">Success: </span>
            <span className={`font-semibold ${successRate >= 95 ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'}`}>
              {successRate.toFixed(0)}%
            </span>
            {errorMessages.length > 0 && (
              <span className="text-[var(--color-error)] ml-1">
                ({errorMessages.length} <XCircle className="inline h-3 w-3" />)
              </span>
            )}
          </div>
        </div>
        
        {/* Duration */}
        {durationMs > 0 && (
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" />
            <div className="text-[12px]">
              <span className="text-[var(--text-secondary)]">Duration: </span>
              <span className="font-semibold text-[var(--text-primary)]">
                {durationMinutes > 0 && `${durationMinutes}m `}
                {durationSeconds}s
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
