/**
 * Trace Message Row
 * Displays trace data for a single message in compact table format
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, User, Bot, Zap } from 'lucide-react';
import { Badge, type BadgeVariant } from '@/components/ui';
import { formatDistanceToNow } from 'date-fns';
import type { KairaChatMessage } from '@/types';
import { extractTraceData } from '../utils/traceDataExtractor';

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

  // Get metadata
  const primaryIntent = extracted.primaryIntent;
  const processingTime = extracted.processingTime;
  const responseId = extracted.responseId;
  const foodState = extracted.foodAgentState;

  // Status badge color
  const getStatusVariant = (): BadgeVariant => {
    switch (message.status) {
      case 'complete': return 'success';
      case 'error': return 'error';
      case 'streaming': return 'warning';
      case 'pending': return 'neutral';
      default: return 'neutral';
    }
  };

  const hasExpandableContent = !isUser && (
    (extracted.allIntents && extracted.allIntents.length > 0) ||
    foodState ||
    (primaryIntent?.reasoning)
  );

  return (
    <div className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-secondary)] transition-colors">
      {/* Main row - table-like grid layout */}
      <div className="grid grid-cols-[auto_60px_100px_1fr_120px_80px] gap-3 px-4 py-2.5 items-start">
        {/* Expand button */}
        <div className="pt-0.5">
          {hasExpandableContent ? (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <div className="w-3.5 h-3.5" />
          )}
        </div>

        {/* Time */}
        <div className="text-[10px] font-mono text-[var(--text-muted)] pt-0.5" title={fullTimestamp}>
          {timeAgo.replace(' ago', '')}
        </div>

        {/* Role */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {isUser ? (
            <User className="h-3 w-3 text-[var(--color-info)]" />
          ) : (
            <Bot className="h-3 w-3 text-[var(--text-brand)]" />
          )}
          <Badge variant={isUser ? 'info' : 'primary'} className="text-[9px]">
            {isUser ? 'User' : 'Bot'}
          </Badge>
        </div>

        {/* Content */}
        <div className="min-w-0">
          <p className="text-[11px] text-[var(--text-primary)] leading-relaxed break-words">
            {message.content.length > 150 && !isExpanded
              ? `${message.content.substring(0, 150)}...`
              : message.content}
          </p>
        </div>

        {/* Metadata */}
        <div className="flex flex-col gap-1">
          {!isUser && primaryIntent && (
            <>
              <Badge variant="neutral" className="text-[9px] w-fit">
                {primaryIntent.agent}
              </Badge>
              <div className="text-[9px] text-[var(--text-muted)]">
                {(primaryIntent.confidence * 100).toFixed(0)}% conf
              </div>
            </>
          )}
        </div>

        {/* Status & Time */}
        <div className="flex flex-col gap-1 items-end">
          <Badge variant={getStatusVariant()} className="text-[9px]">
            {message.status}
          </Badge>
          {processingTime !== undefined && (
            <div className="flex items-center gap-0.5 text-[9px] text-[var(--text-muted)]">
              <Zap className="h-2.5 w-2.5" />
              {processingTime.toFixed(2)}s
            </div>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && hasExpandableContent && (
        <div className="px-4 pb-3 ml-[calc(60px+100px+1.5rem)]">
          <div className="rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] overflow-hidden">
            {/* Intent details */}
            {primaryIntent?.reasoning && (
              <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                <div className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">
                  Intent Reasoning
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  {primaryIntent.reasoning}
                </p>
              </div>
            )}

            {/* Multi-intent info */}
            {extracted.isMultiIntent && extracted.allIntents && extracted.allIntents.length > 1 && (
              <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                <div className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">
                  Multi-Intent Detected
                </div>
                <div className="flex flex-wrap gap-1">
                  {extracted.allIntents.map((intent, idx) => (
                    <Badge key={idx} variant="neutral" className="text-[9px]">
                      {intent.agent} ({(intent.confidence * 100).toFixed(0)}%)
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* FoodAgent state */}
            {foodState && (
              <div className="px-3 py-2">
                <div className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
                  Agent State
                </div>
                
                {/* Foods logged */}
                {foodState.current_entry?.foods && foodState.current_entry.foods.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">Foods:</div>
                    <div className="flex flex-wrap gap-1">
                      {foodState.current_entry.foods.map((food, idx) => (
                        <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                          {food.quantity} {food.unit} {food.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Nutrition */}
                {foodState.nutrition_data && (
                  <div className="mb-2">
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">Nutrition:</div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      <span className="text-[var(--text-secondary)]">
                        <strong>{foodState.nutrition_data.total_calories}</strong> cal
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        <strong>{foodState.nutrition_data.total_protein}g</strong> protein
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        <strong>{foodState.nutrition_data.total_carbs}g</strong> carbs
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        <strong>{foodState.nutrition_data.total_fats}g</strong> fat
                      </span>
                    </div>
                  </div>
                )}

                {/* Session flags */}
                {(foodState.food_logged !== undefined ||
                  foodState.is_meal_confirmed !== undefined ||
                  foodState.can_session_end !== undefined) && (
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">Session:</div>
                    <div className="flex gap-2 text-[9px]">
                      {foodState.food_logged !== undefined && (
                        <Badge variant={foodState.food_logged ? 'success' : 'neutral'} className="text-[9px]">
                          {foodState.food_logged ? 'Logged' : 'Not logged'}
                        </Badge>
                      )}
                      {foodState.is_meal_confirmed !== undefined && (
                        <Badge variant={foodState.is_meal_confirmed ? 'success' : 'neutral'} className="text-[9px]">
                          {foodState.is_meal_confirmed ? 'Confirmed' : 'Unconfirmed'}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Response ID */}
            {responseId && (
              <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)]">
                <code className="text-[9px] text-[var(--text-muted)] font-mono">
                  {responseId}
                </code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {message.errorMessage && (
        <div className="px-4 pb-2 ml-[calc(60px+100px+1.5rem)]">
          <div className="text-[10px] text-[var(--color-error)] bg-[var(--color-error)]/10 px-2 py-1 rounded">
            {message.errorMessage}
          </div>
        </div>
      )}
    </div>
  );
}
