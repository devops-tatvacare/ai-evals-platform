/**
 * Trace Message Row
 * Displays trace data for a single message with expandable details
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, User, Bot, Clock, Hash } from 'lucide-react';
import { Card, Badge, type BadgeVariant } from '@/components/ui';
import { formatDistanceToNow } from 'date-fns';
import type { KairaChatMessage } from '@/types';
import { cn } from '@/utils';
import { extractTraceData } from '../utils/traceDataExtractor';
import { IntentClassificationCard } from './IntentClassificationCard';
import { AgentStateCard } from './AgentStateCard';

interface TraceMessageRowProps {
  message: KairaChatMessage;
}

export function TraceMessageRow({ message }: TraceMessageRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isUser = message.role === 'user';
  const metadata = message.metadata;
  
  // Extract structured data
  const extracted = extractTraceData(metadata);

  // Format timestamp
  const timeAgo = formatDistanceToNow(new Date(message.timestamp), { addSuffix: true });
  const fullTimestamp = new Date(message.timestamp).toLocaleString();

  // Get intent info for assistant messages
  const primaryIntent = extracted.primaryIntent;
  const processingTime = extracted.processingTime;
  const responseId = extracted.responseId;

  // Status badge color
  const getStatusColor = (): BadgeVariant => {
    switch (message.status) {
      case 'complete': return 'success';
      case 'error': return 'error';
      case 'streaming': return 'warning';
      case 'pending': return 'neutral';
      default: return 'neutral';
    }
  };

  // Confidence badge variant
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return { label: 'High', variant: 'success' as BadgeVariant };
    if (confidence >= 0.5) return { label: 'Medium', variant: 'warning' as BadgeVariant };
    return { label: 'Low', variant: 'error' as BadgeVariant };
  };

  return (
    <Card className="p-4">
      {/* Header Row */}
      <div className="flex items-start gap-3">
        {/* Expand Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0 mt-1"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Role Icon */}
        <div className={cn(
          'shrink-0 h-8 w-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-[var(--color-info)]/10' : 'bg-[var(--color-brand-accent)]/10'
        )}>
          {isUser ? (
            <User className="h-4 w-4 text-[var(--color-info)]" />
          ) : (
            <Bot className="h-4 w-4 text-[var(--text-brand)]" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top Row: Role, Status, Time */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={isUser ? 'info' : 'primary'}>
              {isUser ? 'User' : 'Assistant'}
            </Badge>
            
            <Badge variant={getStatusColor()}>
              {message.status}
            </Badge>

            <span className="text-[12px] text-[var(--text-muted)]" title={fullTimestamp}>
              <Clock className="inline h-3 w-3 mr-1" />
              {timeAgo}
            </span>

            {/* Intent info for assistant messages */}
            {!isUser && primaryIntent && (
              <>
                <Badge variant="neutral">
                  {primaryIntent.agent}
                </Badge>
                <Badge variant={getConfidenceBadge(primaryIntent.confidence).variant}>
                  {getConfidenceBadge(primaryIntent.confidence).label} ({(primaryIntent.confidence * 100).toFixed(0)}%)
                </Badge>
              </>
            )}

            {/* Processing time */}
            {processingTime && (
              <Badge variant="neutral">
                {processingTime.toFixed(2)}s
              </Badge>
            )}
          </div>

          {/* Message Content Preview */}
          <div className="text-[13px] text-[var(--text-primary)] mb-2">
            {message.content.length > 200 && !isExpanded
              ? `${message.content.substring(0, 200)}...`
              : message.content}
          </div>

          {/* Response ID (copyable) */}
          {responseId && (
            <div className="flex items-center gap-2 mt-2">
              <Hash className="h-3 w-3 text-[var(--text-muted)]" />
              <code className="text-[11px] text-[var(--text-muted)] font-mono">
                {responseId}
              </code>
            </div>
          )}

          {/* Error message */}
          {message.errorMessage && (
            <div className="mt-2 text-[12px] text-[var(--color-error)] bg-[var(--color-error)]/10 p-2 rounded">
              {message.errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mt-4 pl-11 space-y-3">
          {/* Intent Classification Card */}
          {!isUser && extracted.allIntents && extracted.allIntents.length > 0 && (
            <IntentClassificationCard
              intents={extracted.allIntents}
              isMultiIntent={extracted.isMultiIntent}
            />
          )}
          
          {/* Agent State Card */}
          {!isUser && extracted.foodAgentState && (
            <AgentStateCard
              agentName="FoodAgent"
              state={extracted.foodAgentState}
            />
          )}
          
          {/* Full Metadata (Collapsed by default in expanded view) */}
          {metadata && (
            <details className="border-t border-[var(--border-subtle)] pt-3">
              <summary className="cursor-pointer text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2 hover:text-[var(--text-primary)]">
                Raw Metadata JSON
              </summary>
              <pre className="text-[11px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)] p-3 rounded overflow-x-auto mt-2">
                {JSON.stringify(metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
