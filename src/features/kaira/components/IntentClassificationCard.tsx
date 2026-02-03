/**
 * Intent Classification Card
 * Displays intent classification metadata with confidence and reasoning
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Target, Brain } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import { cn } from '@/utils';
import type { IntentClassification } from '../utils/traceDataExtractor';

interface IntentClassificationCardProps {
  intents: IntentClassification[];
  isMultiIntent?: boolean;
  classificationTime?: number;
}

export function IntentClassificationCard({
  intents,
  isMultiIntent,
  classificationTime,
}: IntentClassificationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (intents.length === 0) return null;
  
  const primaryIntent = intents[0];
  
  // Confidence level badge
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return { label: 'High Confidence', variant: 'success' as const };
    if (confidence >= 0.5) return { label: 'Medium Confidence', variant: 'warning' as const };
    return { label: 'Low Confidence', variant: 'error' as const };
  };
  
  const confidenceBadge = getConfidenceBadge(primaryIntent.confidence);
  
  return (
    <Card className="bg-[var(--bg-elevated)] border-[var(--border-subtle)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--text-brand)]" />
            <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Intent Classification
            </h4>
            {isMultiIntent && (
              <Badge variant="warning">Multi-Intent</Badge>
            )}
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      
      {/* Summary View */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            {/* Primary Intent */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {primaryIntent.agent}
              </span>
              <Badge variant={confidenceBadge.variant}>
                {confidenceBadge.label}
              </Badge>
              <span className="text-[12px] text-[var(--text-muted)]">
                {(primaryIntent.confidence * 100).toFixed(1)}%
              </span>
            </div>
            
            {/* Confidence Meter */}
            <div className="w-full h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-2">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  primaryIntent.confidence >= 0.8 && 'bg-[var(--color-success)]',
                  primaryIntent.confidence >= 0.5 && primaryIntent.confidence < 0.8 && 'bg-[var(--color-warning)]',
                  primaryIntent.confidence < 0.5 && 'bg-[var(--color-error)]'
                )}
                style={{ width: `${primaryIntent.confidence * 100}%` }}
              />
            </div>
            
            {/* Query Type */}
            {primaryIntent.query_type && (
              <div className="text-[12px] text-[var(--text-secondary)]">
                Query Type: <span className="text-[var(--text-primary)]">{primaryIntent.query_type}</span>
              </div>
            )}
            
            {/* Classification Time */}
            {classificationTime !== undefined && (
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                Classification time: {classificationTime.toFixed(2)}s
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-3">
          {/* LLM Reasoning */}
          {primaryIntent.reasoning && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Brain className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <h5 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                  LLM Reasoning
                </h5>
              </div>
              <div className="text-[12px] text-[var(--text-primary)] bg-[var(--bg-tertiary)] p-3 rounded">
                {primaryIntent.reasoning}
              </div>
            </div>
          )}
          
          {/* Additional Intents (if multi-intent) */}
          {isMultiIntent && intents.length > 1 && (
            <div>
              <h5 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
                Additional Intents
              </h5>
              <div className="space-y-2">
                {intents.slice(1).map((intent, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[12px]">
                    <span className="text-[var(--text-primary)]">{intent.agent}</span>
                    <Badge variant={getConfidenceBadge(intent.confidence).variant}>
                      {(intent.confidence * 100).toFixed(1)}%
                    </Badge>
                    {intent.query_type && (
                      <span className="text-[var(--text-muted)]">({intent.query_type})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
